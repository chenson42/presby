# recordAudit() helper — populate audit ip/user_agent, collapse duplicated inserts — Work Log

> **Slug:** `2026-07-01-record-audit-helper`
> **Surface:** mixed (src/lib/audit + every actions.ts that writes audit_events)
> **Permission(s):** none — no permission change
> **Flag(s):** not needed
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-01 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-01 |
| 3 — Technical design | tech-lead | Complete | — | 2026-07-01 |
| 4 — Implementation | api-developer | Complete | — | 2026-07-01 |
| 5 — Verification | qa | Complete | PASS | 2026-07-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-01 |

---

## Intent (from harvest, 2026-07-01)

The `audit_events` schema defines `ip` and `user_agent` columns
(`src/lib/db/schema.ts:205-206`) but **no call site populates them** — every
audit insert in the codebase is a raw `db.insert(auditEvents).values({...})`
that omits both, so the columns are always NULL and the audit log loses its
forensic value (who did this *from where*).

**Requested change:** a centralized `recordAudit()` helper modeled on
fertilityluna's `src/lib/audit/record.ts`:

- Resolves the actor from `auth()` automatically (with an explicit
  `actor: null` override for cron/webhook/system writes).
- Pulls `ip` from headers with the precedence `cf-connecting-ip` →
  `x-forwarded-for` → `x-real-ip` (respecting the starter's existing
  `TRUST_PROXY_HEADERS` gate in `src/lib/rate-limit.ts` — the tech-lead must
  reconcile the two IP-extraction implementations rather than shipping a
  second divergent one).
- Pulls `user_agent` from `headers()`.
- Swallows failures (an audit write must never take down the mutation it
  records) — but decide and document whether swallow-silently or
  swallow-and-console.warn.
- All existing raw `db.insert(auditEvents)` call sites (8+ files) migrate to
  the helper.

**Constraints:**
- `npm run check:audit` (the tripwire that every mutation in actions.ts
  references an AUDIT_ACTIONS key) must still pass — confirm the tripwire's
  grep patterns still match after call sites move to `recordAudit()`; adjust
  the tripwire if needed, in the same change.
- The helper is server-only (uses `headers()`/`auth()`) — must not leak into
  the Edge proxy.

**Source references:** `docs/reviews/2026-07-01-sibling-harvest.md` Tier 1
item 6; fertilityluna `/Users/cshenso/git/fertilityluna/src/lib/audit/record.ts`.

---

## Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

This is a pure server-side refactor with no new UI, no permission changes, no schema changes,
and no feature flags. The developer is the primary "user" of the helper; the admin is a
secondary beneficiary once an audit viewer surfaces ip/user_agent (which does not exist today).
The feature has one hard gate: the `check:audit` tripwire matches `\bauditEvents\b` in
actions.ts files; migrating to `recordAudit()` removes the `auditEvents` token and breaks
the tripwire for every migrated file unless the script is updated in the same commit. There
is also one structurally awkward call site (verify-email page, inside `db.batch()`) that
needs an explicit design decision on atomicity.

### What I Did

#### Pass 1 — User Verbs

This feature has no anonymous-visitor or member-facing flow. The surfaces and verbs are:

| Surface | Verb | Cadence |
|---------|------|---------|
| Developer / maintainer | calls `recordAudit()` instead of raw insert | on every security-sensitive mutation |
| Developer / maintainer | runs `npm run check:audit` and expects PASS | on every PR |
| Admin (future) | reads ip / user_agent in audit log viewer | on demand |

"Admin" is listed as future because there is no audit viewer page today. The admin shell
(`/admin`) has subpages for users, flags, docs, and 2FA management; no audit log viewer
exists anywhere under `src/app/(admin)/`. Surfacing ip/user_agent is the value unlock of
this change, but that value is latent until a viewer is built.

#### Pass 2 — Flow Audit

**Flow 1 — Security-sensitive mutation → audit row written:**
Developer calls `recordAudit({ action, resourceType, resourceId, metadata })` from inside
a server action → helper calls `auth()` to resolve actor (or uses passed `actor` override)
→ calls `headers()` to extract ip and user_agent → inserts row into `audit_events` with
all six fields populated → returns void. If the insert fails, the exception is caught and
logged to stderr; the calling action is unaffected.

Failure path: DB down or timeout → caught in the helper's outer try-catch →
`console.error("[audit] failed to write event", action, err)` → helper returns void →
calling action continues normally. The primary mutation (role change, flag toggle, etc.)
has already succeeded.

**Flow 2 — Developer runs `npm run check:audit`:**
Script walks `src/app/**/actions.ts` → for each file with a db mutation, checks for
`\bauditEvents\b` → after migration, this token is gone from every migrated file →
script exits 1. This flow MUST be updated to also accept `\brecordAudit\b`.

**Flow 3 — No-request context (seed script, future cron):**
Caller passes `actor: null` explicitly → helper skips `auth()` → attempts `headers()` →
`headers()` throws (no request context) → caught by inner try-catch → ip and user_agent
both null → insert proceeds with null fields. This is the correct behavior and the
reference implementation already handles it identically.

#### Pass 3 — Permissions and Flags

- No new `FEATURES` key is needed. This change is invisible to the permission model.
- No feature flag is needed. This is a refactor that can ship in a single PR without
  staged rollout; there is no user-visible behavior change to roll back.
- No schema change. `ip` (`text`, nullable) and `user_agent` (`text`, nullable) already
  exist in `audit_events` (`src/lib/db/schema.ts:205-206`). Both columns accept null and
  will simply start receiving real values rather than null after migration.

#### Pass 4 — Edge Cases the Request Didn't Address

See Gaps section below.

#### Pass 5 — Adversarial Pass

- **Redirect targets:** No redirect parameters are involved in this feature.
- **State-machine shortcuts:** Not applicable; this is a library helper with no route of
  its own.
- **Enumeration leaks:** Not applicable.
- **Input boundaries:** The `action` string is typed as `AuditActionKey` (a keyof
  `AUDIT_ACTIONS`). The helper's input type constrains the caller at compile time. No
  user-controlled data reaches the audit row except through already-validated server action
  inputs (`metadata`, `resourceId`) — the same exposure that exists today with raw inserts.
- **Self-targeting:** Not applicable. The helper writes to the audit table; it doesn't
  grant permissions or change session state.
- **IP spoofing via cf-connecting-ip:** If Cloudflare is not in the request path, an
  attacker cannot inject a `cf-connecting-ip` header to spoof an IP on Vercel (Vercel
  strips unknown headers at the edge). The header is safe to prefer when present. The
  existing `getRequestIp()` implementation in `src/lib/rate-limit.ts` does NOT check
  `cf-connecting-ip`; the new helper's precedence must either extend `getRequestIp()` or
  diverge from it. Divergence is a risk (two different IPs in the same request for rate
  limiting vs auditing). Extension is the correct path (see Gaps).
- **Actor injection:** The `actor` override parameter is typed as
  `{ userId: string | null; email: string | null } | null | undefined`. An untrusted
  caller could pass a spoofed actor. However, all call sites are server-side (`"use
  server"` files or Server Component pages); there is no client path to call
  `recordAudit()` directly, so actor injection via the network is not possible.

### Call Site Inventory

22 direct `db.insert(auditEvents)` call sites across 9 source files in `src/app/`,
plus 1 exempt call in `src/lib/rate-limit.ts` (explicitly exempt from the tripwire;
see AUDIT note in that file).

| # | File | Line(s) | Action key(s) | Actor source | Runtime context | Notes |
|---|------|---------|---------------|--------------|-----------------|-------|
| 1 | `src/app/(auth)/totp/actions.ts` | 34 (inside `logAttempt` helper) | TOTP_VERIFY_FAILED, TOTP_VERIFY_SUCCEEDED, TOTP_RECOVERY_FAILED, TOTP_RECOVERY_SUCCEEDED | passed as params (from session) | Server Action | `logAttempt()` is a local helper called 5×; migration eliminates the helper or routes it through `recordAudit()` |
| 2 | `src/app/(account)/account/2fa/actions.ts` | 155, 191 | TOTP_ENROLLED, TOTP_RECOVERY_CODES_REGENERATED | session.user | Server Action | actor always present (returns error if not) |
| 3 | `src/app/(account)/account/actions.ts` | 39, 161, 186, 245, 270 | USER_PROFILE_UPDATED, USER_EMAIL_CHANGE_REQUESTED, USER_EMAIL_CHANGE_CANCELLED, USER_PASSWORD_CHANGED, USER_DELETION_REQUESTED | session.user | Server Action | actor always present (returns error if not) |
| 4 | `src/app/(email-verify)/account/verify-email/[token]/page.tsx` | 75 | USER_EMAIL_CHANGED | tokenRow.userId / newEmail (NOT auth()) | Server Component Page | SPECIAL: insert is inside `db.batch([...])` for atomicity; page is intentionally unauthenticated; actor must be passed explicitly; see Gap 2 |
| 5 | `src/app/(password-reset)/actions.ts` | 81, 177 | USER_PASSWORD_RESET_REQUESTED, USER_PASSWORD_RESET_COMPLETED | userRow.id / userRow.email (NOT auth()) | Server Action | Unauthenticated flow; actor must be passed explicitly |
| 6 | `src/app/(admin)/admin/flags/actions.ts` | 27 | FEATURE_FLAG_TOGGLED | session.user | Server Action | actor always present (throws if not admin) |
| 7 | `src/app/(admin)/admin/2fa/actions.ts` | 114, 141, 165 | TOTP_ENROLLED, TOTP_RECOVERY_CODES_REGENERATED, TOTP_RESET | session.user | Server Action | actor always present (redirects if not) |
| 8 | `src/app/(admin)/admin/users/actions.ts` | 40, 67, 120, 152 | USER_ROLE_ASSIGNED, USER_ROLE_REMOVED, USER_DEACTIVATED, USER_REACTIVATED | session.user | Server Action | actor always present (throws if not admin) |
| 9 | `src/app/(admin)/admin/users/[id]/actions.ts` | 56, 106 | USER_2FA_REQUIRED_CHANGED, USER_2FA_FORCE_RESET | session.user | Server Action | actor always present (returns error if not) |
| — | `src/lib/rate-limit.ts` | 238 | RATE_LIMIT_BLOCKED | passed explicitly (userId, actor string) | Lib (Node) | Exempt from tripwire by design; uses `.catch()` fire-and-forget; do NOT migrate |

Total migrated call sites: 22 across 9 files.

### Outputs

- Analysis based on:
  - `src/lib/db/schema.ts:193-216` — audit_events table definition
  - `src/lib/rate-limit.ts` — getRequestIp() implementation and existing audit write pattern
  - `scripts/check-audit-coverage.mjs` — tripwire logic (MUTATION_RE, AUDIT_RE)
  - `src/lib/audit.ts` — AUDIT_ACTIONS catalog
  - All 9 actions.ts / page.tsx call site files (read in full)
  - `/Users/cshenso/git/fertilityluna/src/lib/audit/record.ts` — reference implementation

### Gaps the Request Didn't Address

**Gap 1 — Tripwire breaks on migration (HARD GATE, Phase 3 must address first).**
`scripts/check-audit-coverage.mjs` line 37: `const AUDIT_RE = /\bauditEvents\b/;`. After
migration, every migrated `actions.ts` file loses the `auditEvents` import and the
`auditEvents` token. The files still contain `db.insert(users)` / `db.update(users)` etc.,
so MUTATION_RE still fires. But AUDIT_RE no longer matches. The script exits 1 for every
migrated file. Fix: change AUDIT_RE to `/\bauditEvents\b|\brecordAudit\b/`. This one-line
change to `scripts/check-audit-coverage.mjs` must land in the same commit as (or before)
the first migrated call site. The tech-lead must call this out as step 1 in the
implementation order.

**Gap 2 — verify-email page: db.batch() atomicity is broken by migration.**
`src/app/(email-verify)/account/verify-email/[token]/page.tsx:67-83` runs three
statements atomically via `db.batch([...])`: the email update, the token deletion, and the
audit insert. If the audit insert is pulled out into `recordAudit()` after the batch, these
guarantees change: the audit row would no longer roll back with the email update if the
batch itself were interrupted. In practice the Neon HTTP driver executes `db.batch()` as a
server-side transaction, so the primary concern is a partial-failure scenario where the
batch succeeds but `recordAudit()` fails (currently caught and swallowed). The tech-lead
must decide: (a) keep a direct insert for this one call site to preserve the batch
transaction, manually extracting ip/user_agent from headers before the batch starts; or (b)
pull the audit out of the batch and call `recordAudit()` after, accepting that a failed
audit write is swallowed rather than rolled back with the mutation. Also: the actor here is
`tokenRow.userId / newEmail`, NOT from `auth()` — the page is intentionally
unauthenticated. Any migration must pass `actor` explicitly; omitting it would cause
`recordAudit()` to call `auth()` which returns null for an unauthenticated visitor.

**Gap 3 — IP extraction divergence: getRequestIp() vs fertilityluna precedence.**
`src/lib/rate-limit.ts:getRequestIp()` uses: `TRUST_PROXY_HEADERS=true` → x-forwarded-for
→ x-real-ip. It does NOT check `cf-connecting-ip`. The fertilityluna reference checks
`cf-connecting-ip` first (unconditionally), then x-forwarded-for, then x-real-ip. Shipping
`recordAudit()` with the fertilityluna precedence creates two different IP-extraction
implementations in the same codebase — rate limiting sees x-real-ip on Cloudflare-fronted
deployments while audit logs see cf-connecting-ip. Recommendation: extend `getRequestIp()`
to check `cf-connecting-ip` as the highest-priority header (it is set by Cloudflare at the
network edge and cannot be spoofed by clients regardless of TRUST_PROXY_HEADERS), then
`recordAudit()` imports and reuses `getRequestIp()` for a single source of truth. The
tech-lead must decide and document this in the design doc.

**Gap 4 — Password-reset call sites: actor is from DB row, not auth().**
`src/app/(password-reset)/actions.ts:81` and `:177` resolve the actor from
`userRow.id / userRow.email` (the password-reset flow is explicitly unauthenticated). If
these call sites migrate to `recordAudit()` without passing `actor` explicitly, the helper
calls `auth()` which returns null, and the audit row is written with null actor even though
the user's identity is known from the DB row. Both call sites must pass
`actor: { userId: userRow.id, email: userRow.email }` explicitly.

**Gap 5 — totp/actions.ts logAttempt() helper: double auth() call if actor omitted.**
`src/app/(auth)/totp/actions.ts` has a local `logAttempt(userId, email, action, metadata)`
helper (line 28-42) that the outer `verifyTotpAction` calls after already resolving
`session = await auth()` at line 45. If the helper is replaced by `recordAudit()` without
passing `actor`, the helper calls `auth()` a second time — a redundant JWT read. The tech-
lead should decide: eliminate the local helper and have each call site pass
`actor: { userId: session.user.id, email: session.user.email ?? null }` explicitly, or
keep the local helper as a thin wrapper that calls `recordAudit()` with the actor already
resolved. Either is fine; just don't silently incur the double auth() call.

**Gap 6 — Failure mode: console.error vs silent swallow.**
`src/lib/rate-limit.ts` uses `.catch(() => {})` (silent swallow). The fertilityluna
reference uses `console.error("[audit] failed to write event", input.action, err)`.
Recommendation: use console.error. Audit failures are ops-relevant signal; a silent swallow
makes them invisible in server logs. The distinction matters if audit writes start failing
at scale (DB connection exhaustion, Neon scale-to-zero cold start, etc.).

**Gap 7 — No admin UI displays ip/user_agent today; surfacing it is deferred.**
Confirmed: no page under `src/app/(admin)/` currently reads or displays any column from
`audit_events`. The columns exist in schema, but there is no audit log viewer. The value
of this change (ip/user_agent become populated) is entirely latent until a viewer is built.
This is a separate feature and explicitly out of scope for this PR. Call it out as a
follow-up so it is tracked.

**Gap 8 — seed.ts does not call any audit function; no change needed.**
`scripts/seed.ts` does not write audit rows. No migration needed there. Confirmed.

### Out of Scope (confirm with user)

- Building an audit log viewer under `/admin/audit` that surfaces ip/user_agent. The
  columns will be populated after this PR, but the viewer is a separate feature.
- Migrating `src/lib/rate-limit.ts`'s `db.insert(auditEvents)` call. That call site is
  intentionally exempt from the tripwire (documented in the file header) and already uses
  the correct fire-and-forget pattern. Leave it as-is.

### Open Questions

1. Verify-email db.batch() treatment (Gap 2): keep the audit insert in the batch (option
   a) or pull it out with `recordAudit()` (option b)? I recommend option b (consistency
   over atomicity of the audit write), but the tech-lead should document the decision.
2. IP extraction strategy (Gap 3): extend `getRequestIp()` to add cf-connecting-ip, or
   implement inline in `recordAudit()`? I recommend extending `getRequestIp()` for single
   source of truth.
3. Is the audit log viewer in scope for this PR or a tracked follow-up? (My read: follow-up.)

---

## Phase 1 — Functional Refinement — 2026-07-01 (work-log entry)

**Owner:** analyst
**Status:** complete

### Summary

22 direct `db.insert(auditEvents)` call sites across 9 source files in src/app/ (7
actions.ts files, 1 page.tsx). Rate-limit.ts has a 23rd write that is intentionally exempt
from the tripwire and should NOT be migrated. The hard gate is the check:audit tripwire:
AUDIT_RE matches `\bauditEvents\b` and will break for every migrated file unless the script
is updated to also match `\brecordAudit\b` in the same commit. Two call sites resolve actor
from a DB row rather than auth() (password-reset, verify-email) and require explicit actor
override. The verify-email page is structurally awkward: it is a Server Component page
(not an actions.ts), it is intentionally unauthenticated, and its audit insert lives inside
a db.batch() for atomicity. There is no admin UI displaying audit events today; ip/user_agent
will be populated after migration but remain invisible until an audit viewer is built.

### What I did

- Grepped all `auditEvents` insert call sites across src/ and scripts/
- Read all 9 source files containing call sites in full
- Read `src/lib/rate-limit.ts` for getRequestIp() design and existing fire-and-forget pattern
- Read `scripts/check-audit-coverage.mjs` for exact tripwire regex patterns
- Read `src/lib/db/schema.ts:193-216` for column types and nullability
- Read `src/lib/audit.ts` for AUDIT_ACTIONS catalog
- Read `/Users/cshenso/git/fertilityluna/src/lib/audit/record.ts` reference implementation
- Confirmed no admin UI reads audit_events (no audit viewer page exists)
- Ran five-pass review and documented all gaps and adversarial findings above
- Updated per-phase status table

### Outputs

- `docs/work-log/2026-07-01-record-audit-helper.md` — this file (Phase 1 section added)
- No code written, no commits made

### Open questions / handoff notes

For architect (Phase 2):
- Placement of `src/lib/audit/record.ts` (new file) vs extending existing `src/lib/audit.ts`
- Whether `recordAudit()` should import `getRequestIp()` from `src/lib/rate-limit.ts` or
  whether IP extraction should be extracted to a shared utility (avoid coupling audit to
  rate-limit module)
- `'import "server-only"'` guard: confirm the helper must be marked server-only and confirm
  it cannot be transitively imported from any Edge-runtime path (the proxy is the main risk)

For tech-lead (Phase 3):
- Gap 1 (tripwire) is a hard gate: address it as step 1 of implementation order
- Gap 2 (verify-email db.batch atomicity) needs an explicit decision
- Gap 3 (IP extraction single source of truth) needs an explicit decision
- Gap 4 and 5 (unauthenticated actor call sites, logAttempt redundancy) must be in the
  design doc so the implementer handles each correctly
- Gap 6 (console.error vs silent swallow): document the recommendation

---

## Phase 3 — Technical Design — 2026-07-01

**Owner:** tech-lead
**Status:** complete

### Summary

`recordAudit()` is added to `src/lib/audit.ts` alongside the existing `AUDIT_ACTIONS` catalog. A new `src/lib/request-ip.ts` module implements the canonical three-tier IP-extraction precedence (DECISION-017). `src/lib/rate-limit.ts` drops its local copy of `getRequestIp` and imports from the new shared module. All 8 migrating `actions.ts` files (and `src/app/(auth)/totp/actions.ts` via `logAttempt` elimination) switch to `recordAudit()`. The `verify-email/[token]/page.tsx` audit insert stays inside `db.batch()` per DECISION-014 — this is the one explicit non-migration. The `rate-limit.ts` fire-and-forget insert also stays as-is. The tripwire `AUDIT_RE` update is step 1 of the implementation order.

### What I did

- Confirmed `src/lib/db/schema.ts:204-206`: `ip text`, `userAgent text("user_agent")` — both nullable, no schema change needed.
- Confirmed `AuditAction` (value union type) is the correct parameter type for `action`; all call sites pass `AUDIT_ACTIONS.X` which evaluates to the string value.
- Confirmed `getRequestIp` is imported from `@/lib/rate-limit` in `src/app/(password-reset)/actions.ts:11` — this import must be updated to `@/lib/request-ip` when `rate-limit.ts` drops its local copy.
- Confirmed the fertilityluna reference's IP extraction (`cf-connecting-ip` unconditional, `x-forwarded-for` inline without TRUST_PROXY_HEADERS gate) diverges from the starter's TRUST_PROXY_HEADERS convention. The design follows DECISION-017 (three-tier precedence with TRUST_PROXY_HEADERS gate on XFF).
- Confirmed `logAttempt()` in `totp/actions.ts` is called 5 times with `session` already resolved. Elimination of the helper is the correct path.
- Read `docs/decisions.md`: DECISION-017 covers everything needed. No new decisions to append.

---

## Technical Design: `recordAudit()` helper

### 1. `recordAudit()` Signature and Types

**Location:** `src/lib/audit.ts` (extensions appended after the existing catalog).

```typescript
// Type for explicit actor override
export type AuditActorOverride = {
  userId: string | null;
  email: string | null;
};

export interface RecordAuditInput {
  /** Typed against the string-value union of AUDIT_ACTIONS. */
  action: AuditAction;
  /**
   * Actor resolution:
   *   undefined (omitted) — call auth() to get the signed-in session.
   *   { userId, email }   — explicit override (unauthenticated flows, logAttempt
   *                         sites where auth() is already resolved).
   *   null                — system write; no actor (seed scripts, future crons).
   */
  actor?: AuditActorOverride | null;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(input: RecordAuditInput): Promise<void>
```

**Actor resolution inside the helper:**

```
if input.actor === undefined  → const session = await auth(); actorUserId = session?.user?.id ?? null; actorEmail = session?.user?.email ?? null
if input.actor is object      → actorUserId = input.actor.userId; actorEmail = input.actor.email
if input.actor === null       → actorUserId = null; actorEmail = null
```

**IP/user-agent extraction:**

Calls `getRequestIp(await headers())` from `@/lib/request-ip`. Wraps `headers()` in its own inner try-catch (not the outer try-catch) so that a missing-request-context error sets `ip = null` and `userAgent = null` without swallowing the outer DB error. This is the no-request-context graceful path (seed scripts, scripts/).

```typescript
let ip: string | null = null;
let userAgent: string | null = null;
try {
  const h = await headers();
  ip = getRequestIp(h);
  userAgent = h.get("user-agent") ?? null;
} catch {
  /* headers() unavailable outside a request — ip and userAgent stay null */
}
```

**Failure semantics:** the entire helper body lives inside a single outer `try-catch`. On any failure (auth() error, DB write error, etc.), the catch block calls `console.error("[audit] failed to write event", input.action, err)` and returns void. The calling action is never affected. Per Phase 2 Ruling 4: `console.error` is the correct choice — audit failures are ops-relevant and `console.error` is not prohibited by CLAUDE.md (only `console.log` is).

**New imports added to `src/lib/audit.ts`:**

```typescript
import "server-only";                              // first line — build-time enforcement
import { headers } from "next/headers";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";
import { getRequestIp } from "@/lib/request-ip";
```

The `import "server-only"` upgrades the current `// server-only` comment to build-time bundler enforcement. No transitive import path from `src/proxy.ts` to `src/lib/audit.ts` exists today; this guard prevents one from being accidentally introduced.

### 2. `src/lib/request-ip.ts`

**New file.** Single exported function. Implements DECISION-017 three-tier precedence.

```typescript
// src/lib/request-ip.ts
import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";

/**
 * Extract the client IP from request headers.
 *
 * Precedence (DECISION-017):
 * 1. cf-connecting-ip — unconditionally trusted when present. Set by Cloudflare at
 *    the network edge; cannot be injected by clients on Cloudflare-fronted deployments.
 *    Absent when Cloudflare is not in the path (Vercel strips unrecognized headers).
 * 2. x-forwarded-for (first value) — consulted only when TRUST_PROXY_HEADERS=true.
 *    Spoofable without a controlled proxy chain; opt-in only.
 * 3. x-real-ip — Vercel's edge-set fallback. Absent in local dev.
 *
 * Returns null when no applicable header is present (local dev, scripts).
 *
 * Pass the result of `await headers()` (next/headers) or `request.headers`.
 */
export function getRequestIp(hdrs: ReadonlyHeaders | Headers): string | null {
  const cfIp = hdrs.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const xff = hdrs.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0].trim();
      if (first) return first;
    }
  }

  const realIp = hdrs.get("x-real-ip");
  if (realIp) return realIp.trim();
  return null;
}
```

**Drop-in compatibility with `rate-limit.ts`:** the existing signature `getRequestIp(hdrs: ReadonlyHeaders | Headers): string | null` is preserved exactly. No call site changes to the function contract. The only behavioral change is the addition of `cf-connecting-ip` as the highest-priority tier.

**`src/lib/rate-limit.ts` changes:** remove the local `getRequestIp` function body (lines 42-76); add `import { getRequestIp } from "@/lib/request-ip"` at the top. Remove the `ReadonlyHeaders` type import if it becomes unused (it was only needed for `getRequestIp`'s parameter type, now owned by `request-ip.ts`).

**`src/app/(password-reset)/actions.ts` import update:** line 11 currently reads `import { getRequestIp, checkRateLimit } from "@/lib/rate-limit"`. After `rate-limit.ts` drops its local copy, this becomes two imports:

```typescript
import { getRequestIp } from "@/lib/request-ip";
import { checkRateLimit } from "@/lib/rate-limit";
```

(Do not re-export `getRequestIp` from `rate-limit.ts` — callers should import from the canonical location.)

### 3. Per-Call-Site Migration Table

**Non-migrations (2 sites — must NOT be touched):**

| Site | Reason |
|------|--------|
| `src/app/(email-verify)/account/verify-email/[token]/page.tsx:75` | Stays inside `db.batch()` per DECISION-014 (atomicity). The audit write must roll back with the email update if the batch fails. Pulling it out and calling `recordAudit()` after the batch would accept a silent-swallow failure for this write, which breaks the transaction guarantee. Accept null ip/user_agent for this one call site. |
| `src/lib/rate-limit.ts:238` | Exempt from tripwire by documented design. Fire-and-forget `.catch(() => {})` is correct for this secondary concern. Not in scope for `check:audit`. |

**Migrating call sites (8 files):**

| # | File | Action keys | Actor call shape | Notes |
|---|------|-------------|-----------------|-------|
| 1 | `src/app/(auth)/totp/actions.ts` | TOTP_VERIFY_FAILED, TOTP_VERIFY_SUCCEEDED, TOTP_RECOVERY_FAILED, TOTP_RECOVERY_SUCCEEDED | `actor: { userId: session.user.id, email: session.user.email ?? null }` (explicit) | Eliminate `logAttempt()` helper entirely. `session` is already resolved at line 45 of `verifyTotpAction`; passing actor explicitly avoids a second `auth()` call (Gap 5 resolution). Each of the 5 `logAttempt(...)` call sites becomes an inline `await recordAudit({ action: ..., actor: { ... }, resourceType: "user", resourceId: session.user.id, metadata: ... })`. |
| 2 | `src/app/(account)/account/2fa/actions.ts` | TOTP_ENROLLED, TOTP_RECOVERY_CODES_REGENERATED | omit `actor` (default `auth()`) | Both call sites guard with early return if no session; auth() will return the same session. |
| 3 | `src/app/(account)/account/actions.ts` | USER_PROFILE_UPDATED, USER_EMAIL_CHANGE_REQUESTED, USER_EMAIL_CHANGE_CANCELLED, USER_PASSWORD_CHANGED, USER_DELETION_REQUESTED | omit `actor` (default `auth()`) | All 5 call sites guard with early return if no session. |
| 4 | `src/app/(password-reset)/actions.ts` | USER_PASSWORD_RESET_REQUESTED, USER_PASSWORD_RESET_COMPLETED | `actor: { userId: userRow.id, email: userRow.email }` (explicit) | Unauthenticated flow; `auth()` returns null. `userRow` is resolved from the DB before the audit write in both actions. Also update `getRequestIp` import from `@/lib/rate-limit` to `@/lib/request-ip`. |
| 5 | `src/app/(admin)/admin/flags/actions.ts` | FEATURE_FLAG_TOGGLED | omit `actor` (default `auth()`) | Session gate already checked (throws if not admin). |
| 6 | `src/app/(admin)/admin/2fa/actions.ts` | TOTP_ENROLLED, TOTP_RECOVERY_CODES_REGENERATED, TOTP_RESET | omit `actor` (default `auth()`) | Session gate already checked (redirects if not admin). |
| 7 | `src/app/(admin)/admin/users/actions.ts` | USER_ROLE_ASSIGNED, USER_ROLE_REMOVED, USER_DEACTIVATED, USER_REACTIVATED | omit `actor` (default `auth()`) | Session gate already checked (throws if not admin). |
| 8 | `src/app/(admin)/admin/users/[id]/actions.ts` | USER_2FA_REQUIRED_CHANGED, USER_2FA_FORCE_RESET | omit `actor` (default `auth()`) | Session gate already checked (returns error if not admin). |

**Import changes per migrating file:** each migrating file removes `auditEvents` from its `@/lib/db/schema` import and (if `auditEvents` is the only schema import removed, simplify accordingly) and adds `recordAudit` to its `@/lib/audit` import. The `AUDIT_ACTIONS` import stays — the action key constants are still passed to `recordAudit()`.

### 4. Implementation Order

**Step 1 (tripwire, hard gate):** Update `scripts/check-audit-coverage.mjs` line 36:

```js
// before
const AUDIT_RE = /\bauditEvents\b/;
// after
const AUDIT_RE = /\bauditEvents\b|\brecordAudit\b/;
```

Run `npm run check:audit` — must pass (nothing migrated yet, all files still have `auditEvents`).

**Step 2 (dependency):** `npm install server-only`. This modifies `package.json` and `package-lock.json` — expected diff. Commit in the same commit as `import "server-only"` in `audit.ts`.

**Step 3 (new module):** Create `src/lib/request-ip.ts` with the function specified above. Run `npm run typecheck`.

**Step 4 (rate-limit refactor):** Update `src/lib/rate-limit.ts`: remove local `getRequestIp` function; add `import { getRequestIp } from "@/lib/request-ip"`. Run `npm run typecheck`. No functional change to `checkRateLimit`.

**Step 5 (audit.ts extension):** Add `import "server-only"` as the first line. Add remaining imports (`headers`, `auth`, `db`, `auditEvents`, `getRequestIp`). Add `AuditActorOverride`, `RecordAuditInput`, and `recordAudit()` after the existing catalog. Run `npm run typecheck`.

**Step 6 (call site migration — admin batch):** Migrate files 5, 6, 7, 8 from the migration table (`admin/flags`, `admin/2fa`, `admin/users`, `admin/users/[id]`). Run `npm run typecheck && npm run check:audit`. The tripwire now passes for these files because they contain `recordAudit`.

**Step 7 (call site migration — account batch):** Migrate files 2, 3 (`account/2fa`, `account/actions`). Run `npm run typecheck && npm run check:audit`.

**Step 8 (call site migration — password-reset):** Migrate file 4. Update `getRequestIp` import. Run `npm run typecheck && npm run check:audit`.

**Step 9 (call site migration — totp, logAttempt elimination):** Migrate file 1. Eliminate `logAttempt` helper. Inline 5 `recordAudit()` calls with explicit actor. Run `npm run typecheck && npm run check:audit`.

**Step 10 (unit tests):** Write `src/lib/request-ip.test.ts` and `src/lib/audit.test.ts` per the test plan below. Run `npm run test`.

**Step 11 (full verification):** `npm run typecheck && npm run build && npm run test && npm run check:audit`.

### 5. Unit Test Plan

**`src/lib/request-ip.test.ts`** (Vitest, no mocking of external modules needed — just `Headers` objects):

- `cf-connecting-ip` present → returns that value; TRUST_PROXY_HEADERS irrelevant
- `cf-connecting-ip` absent, `TRUST_PROXY_HEADERS=true`, `x-forwarded-for: 1.2.3.4, 5.6.7.8` → returns `"1.2.3.4"` (first value only)
- `cf-connecting-ip` absent, `TRUST_PROXY_HEADERS=false`, `x-forwarded-for` present → returns null (XFF ignored)
- `cf-connecting-ip` absent, `TRUST_PROXY_HEADERS=false`, `x-real-ip: 9.9.9.9` → returns `"9.9.9.9"`
- No applicable headers → returns null
- All three headers present, `TRUST_PROXY_HEADERS=true` → returns `cf-connecting-ip` (highest priority wins)

**`src/lib/audit.test.ts`** (Vitest; mock `auth`, `headers`, `db.insert`):

- Actor `undefined` (omitted) → `auth()` called; `actorUserId`/`actorEmail` from session
<!-- leak-ok: toy placeholder value, not a real address -->
- Actor explicit `{ userId: "u1", email: "a@b.com" }` → `auth()` NOT called; values used
- Actor `null` → `auth()` NOT called; `actorUserId`/`actorEmail` both null
- `headers()` returns valid headers → `ip` and `userAgent` populated from them
- `headers()` throws (no request context) → `ip = null`, `userAgent = null`; insert still called
- `db.insert` rejects → outer catch fires; `console.error` called with `"[audit]"` prefix; function returns void (no throw)
- `metadata` omitted → insert receives `{}`

### 6. Regression Risk

Action string values are frozen literals in `AUDIT_ACTIONS`. No call site changes any action key — each `AUDIT_ACTIONS.X` reference evaluates to the same string value before and after migration. The `metadata` shape is passed through verbatim from each call site. Existing audit rows in the database are unaffected.

`ip` and `userAgent` are additive nullable columns already defined in `schema.ts:204-206`. They currently receive null from every insert; after migration they receive real values. No schema change. No migration needed.

### 7. `docs/TODO.md` — Backlog entry

Per Phase 2 Ruling 7, the following line must be added to the **Backlog** section of `docs/TODO.md` in the same PR as the migration:

```
- [ ] Audit log viewer under /admin/audit — display ip, user_agent, actorEmail, metadata per row; filter by action and date range — follow-up, record-audit-helper work-log
```

### Outputs

- Design written to `docs/work-log/2026-07-01-record-audit-helper.md` (this file)
- No new `docs/decisions.md` entries: DECISION-017 covers IP extraction and shared module placement. The `logAttempt` elimination is an implementation-level call, not an architectural decision. `console.error` semantics endorsed in Phase 2 Ruling 4.
- `docs/TODO.md` backlog entry added (in this pass)

### Open questions / handoff notes

For **api-developer** (Phase 4 implementer):

This is all server-side: 2 new/extended lib files + 1 new lib file + 8 call-site files + 2 test files. No UI, no schema change, no permission change. Use the **api-developer** agent.

Key implementer notes:
- Follow the implementation order strictly. Step 1 (tripwire update) must land before any call site migration to avoid false-positive failures on `npm run check:audit`.
- `npm install server-only` modifies `package.json` and `package-lock.json`. This is an expected diff — include both files in the commit.
- The `password-reset/actions.ts` import must be updated: `getRequestIp` moves from `@/lib/rate-limit` to `@/lib/request-ip`. Running typecheck after Step 8 will catch any missed import.
- The `logAttempt()` helper in `totp/actions.ts` must be eliminated entirely — do not leave it as a wrapper. All 5 call sites get inline `recordAudit()` calls with the explicit actor object already constructed from `session.user`.
- The `verify-email/[token]/page.tsx` is NOT migrated. Leave the direct `db.insert(auditEvents).values({...})` inside the `db.batch()` exactly as is.
- The `rate-limit.ts` insert is NOT migrated. Leave the fire-and-forget `.catch(() => {})` pattern exactly as is.
- Run `npm run check:audit` after every migration batch (Steps 6, 7, 8, 9), not only at the end.

---

## Phase 2 — Architectural Review — 2026-07-01

**Owner:** architect
**Status:** complete

### Summary

**Approved with suggestions.** The feature is architecturally sound: no new route group, no schema change, no permission change, no feature flag. Seven structural rulings are documented below and must be carried into the tech-lead's Phase 3 design doc. One new npm dependency is required (`server-only`). One new shared module is required (`src/lib/request-ip.ts` — see DECISION-017). The remaining rulings are explicit endorsements or overrides of the analyst's recommendations.

### What I did

- Read `src/lib/audit.ts` (41-line catalog; `// server-only` comment convention; no actual package guard)
- Read `src/lib/rate-limit.ts` — confirmed `getRequestIp()` implementation and existing fire-and-forget audit pattern
- Read `scripts/check-audit-coverage.mjs` — confirmed `AUDIT_RE = /\bauditEvents\b/` (not `\brecordAudit\b`) and the file-scope walker targets `actions.ts` under `src/app/`
- Read `package.json` — confirmed `server-only` is NOT a current dependency
- Read `/Users/cshenso/git/fertilityluna/src/lib/audit/record.ts` — the reference implementation
- Verified no `import "server-only"` calls exist anywhere in `src/` (only comment-style guards)

### Seven Rulings

**Ruling 1 — Directory placement: extend `src/lib/audit.ts` (no new directory, no sibling file).**

The intake proposed `src/lib/audit/record.ts`, modeled on fertilityluna. That layout requires
renaming the current `audit.ts` (which holds the AUDIT_ACTIONS catalog all 8+ call sites
import) to `audit/events.ts`, updating every import. The import-path churn has no functional
benefit at this file count. The correct approach is to add `recordAudit()` directly to the
existing `src/lib/audit.ts`. The file grows from 41 to roughly 80 lines — still
single-pass readable. One import path (`@/lib/audit`) for both catalog and helper is the
simpler teaching model. If the file grows significantly in the future (metadata builders,
batching, etc.), a directory split is the right next step — that belongs in a future
pipeline entry.

**Ruling 2 — IP extraction: extract to `src/lib/request-ip.ts` (new shared module). See DECISION-017.**

Two options were rejected:
- Import `getRequestIp()` from `src/lib/rate-limit.ts` into `src/lib/audit.ts`: backwards
  coupling — audit should not depend on the rate-limiting module.
- Inline IP extraction in `recordAudit()`: duplicates logic; violates single-source-of-truth.

The ruling is: extract `getRequestIp()` to a new `src/lib/request-ip.ts` with the updated
three-tier precedence (`cf-connecting-ip` unconditionally → `x-forwarded-for` when
`TRUST_PROXY_HEADERS=true` → `x-real-ip`). Both `rate-limit.ts` (removing its local copy)
and `audit.ts` (the new helper) import from `@/lib/request-ip`. This is the only structural
new module in this feature. Adding `cf-connecting-ip` at the top of the precedence is
correct: Cloudflare sets it at the network edge; it cannot be spoofed by clients on
Cloudflare-fronted deployments; it is absent when Cloudflare is not in the path. The
`TRUST_PROXY_HEADERS` gate on `x-forwarded-for` is preserved unchanged.

**Ruling 3 — Server-only boundary: add `server-only` package; use `import "server-only"` in `src/lib/audit.ts`.**

The current `// server-only` comment in `audit.ts` is a convention, not enforcement. The
`server-only` npm package is the canonical Next.js 13+ mechanism — it causes the bundler to
error at build time if the module is imported from a Client Component or the Edge runtime.
`server-only` is not in `package.json` today; it must be added as a direct dependency. The
package is a single empty JS file with a special marker — zero runtime footprint, MIT
license, actively maintained as part of the Next.js ecosystem. Adding `import "server-only"`
to `audit.ts` (as the first import, matching fertilityluna's pattern) upgrades the existing
comment-only guard to build-time enforcement and models the correct pattern for all future
server-only modules in the starter. The Edge proxy (`src/proxy.ts`) imports from
`src/lib/auth/config.ts` only — which is edge-safe by design. There is no transitive import
path from `proxy.ts` to `audit.ts` today, and the `server-only` guard prevents one from
being accidentally introduced.

**Ruling 4 — Failure semantics: use `console.error` (not silent swallow).**

The starter's CLAUDE.md rule is "No `console.log` left in production paths" — `console.log`
specifically. `console.error` in a swallowed failure path is not prohibited and is the
standard mechanism for ops-relevant signal in server-side Node code. Audit failures (DB
connection exhaustion, Neon scale-to-zero cold start, connection limit) are exactly the
class of ops signal that needs to surface in server logs. The rate-limit.ts `.catch(() => {})` 
pattern is correct for that module (the rate-limit audit write is a tertiary concern and 
fails silently by design), but for a helper whose only job is to write audit rows, a silent
swallow makes all failures invisible. The analyst's recommendation (`console.error`) is
endorsed. The fertilityluna reference pattern (`console.error("[audit] failed to write event",
input.action, err)`) is the correct model.

**Ruling 5 — Tripwire: `AUDIT_RE` must be updated in the same PR; update is step 1 of implementation order.**

`scripts/check-audit-coverage.mjs` line 36: `const AUDIT_RE = /\bauditEvents\b/;`. After any
call site migrates to `recordAudit()`, the `auditEvents` token disappears from that file but
`MUTATION_RE` still fires (the file still has `db.insert(users)` etc.). Every migrated file
will cause `npm run check:audit` to exit 1. The one-line fix: change `AUDIT_RE` to
`/\bauditEvents\b|\brecordAudit\b/`. This fix MUST be committed before or atomically with
the first migrated call site. The tech-lead must make this the first step in the
implementation order and must verify that `npm run check:audit` passes after every batch of
migrations, not only at the end. The rate-limit.ts write is exempt from the tripwire by
documented design (it lives in `src/lib/`, not `src/app/**/actions.ts`); it must not be
migrated. The verify-email `page.tsx` is also not in scope for the tripwire (the scanner
targets `actions.ts` files only); its audit insert stays in the `db.batch()` per DECISION-014
(atomicity convention) — see Ruling 5 note below.

Note on verify-email: the analyst identified Gap 2 (db.batch atomicity) as a tech-lead
decision. Given DECISION-014 (which codifies `db.batch()` as the project convention for
atomic multi-write), the correct ruling here is: the audit insert in the verify-email page
STAYS inside the `db.batch()` as a direct `db.insert(auditEvents).values({...})`. Migrating
it to `recordAudit()` would require pulling the audit write out of the batch, losing the
atomicity guarantee. DECISION-014 is explicit that the batch pattern is the convention. The
tech-lead must document this exception in the design doc: the verify-email page retains its
direct batch insert (and must manually construct ip/user_agent from `headers()` if that
population is desired — or accept null for that one call site given it is unauthenticated
and atomicity trumps ip/user_agent population).

**Ruling 6 — Dependencies: one new dependency only (`server-only`).**

No other new dependency is required. All other imports in `recordAudit()` (`next/headers`,
`@/auth`, `@/lib/db`, `@/lib/db/schema`, `@/lib/request-ip`) are either already in
`package.json` or are new internal modules introduced by this feature. The `server-only`
package passes all five evaluation criteria from CLAUDE.md: (1) not already solved by an
existing dep; (2) actively maintained (part of the Next.js ecosystem); (3) irrelevant to
Edge runtime (the function is server-only by definition); (4) zero bundle impact; (5) MIT
license.

**Ruling 7 — Scope: admin audit viewer is OUT; track in docs/TODO.md.**

The analyst confirmed no audit log viewer exists today anywhere under `src/app/(admin)/`.
The columns (`ip`, `user_agent`) will be populated after this PR but remain invisible to
users until a viewer is built. The viewer is a separate feature with its own pipeline entry.
The tech-lead must add a line to `docs/TODO.md` (or create it if absent) noting the
follow-up: "Audit log viewer under /admin/audit — display ip, user_agent, actorEmail,
metadata per row; filter by action and date range." That entry keeps the follow-up
discoverable without blocking this PR.

### Outputs

- `docs/decisions.md` — DECISION-017 appended (IP extraction to shared module)
- `docs/work-log/2026-07-01-record-audit-helper.md` — Phase 2 section added; status row updated

### Open questions / handoff notes

For tech-lead (Phase 3):

- **Gap 1 (tripwire) is implementation step 1.** Update `AUDIT_RE` in
  `scripts/check-audit-coverage.mjs` before any call site migration. Gate every batch of
  migrations on a passing `npm run check:audit`.
- **verify-email `db.batch()` exception (Gap 2).** Per DECISION-014 and Ruling 5 above:
  the audit insert stays inside the batch. The page retains a direct `db.insert(auditEvents)`
  call with manually extracted ip/user_agent — or accepts null for those fields. Document
  this exception explicitly in the design doc.
- **`src/lib/request-ip.ts` is a new module.** Tech-lead authors it in the design doc;
  implementer creates it. The function signature must match `getRequestIp(hdrs: ReadonlyHeaders | Headers): string | null`
  to stay compatible with `rate-limit.ts`'s existing call site.
- **`server-only` install.** The implementer must run `npm install server-only` (or
  `npm install --save server-only`). The dependency addition must be in the same commit as
  the `import "server-only"` line in `audit.ts`.
- **Gaps 4 and 5 (unauthenticated actor call sites, logAttempt redundancy).** These are
  implementation-level — the tech-lead must call them out in the design doc so the
  implementer handles each correctly (see analyst Phase 1 for detail).
- **`console.error` is the endorsed pattern.** No further decision needed; the tech-lead
  should carry this into the implementation spec.

---

## Phase 4 — Implementation (API) — 2026-07-01

**Owner:** api-developer
**Status:** complete

### Summary

All 20 direct `db.insert(auditEvents)` call sites across 8 `actions.ts` files were migrated to `recordAudit()`. The `verify-email/[token]/page.tsx` and `rate-limit.ts` writes were left untouched per DECISION-014 and the design spec. `src/lib/request-ip.ts` was extracted as a new shared module implementing the DECISION-017 three-tier IP precedence. `src/lib/audit.ts` was extended with `import "server-only"`, `AuditActorOverride`, `RecordAuditInput`, and `recordAudit()`. The `logAttempt()` helper in `totp/actions.ts` was eliminated and replaced with 5 inline `recordAudit()` calls using explicit actor objects. All 222 unit tests pass; build is clean; 20/20 e2e tests pass against the running dev server.

### What I did

- **Step 1 (tripwire):** Updated `AUDIT_RE` in `scripts/check-audit-coverage.mjs` from `/\bauditEvents\b/` to `/\bauditEvents\b|\brecordAudit\b/`. Updated error message text to mention both patterns. Verified `check:audit` passes before any migrations.
- **Step 2 (dependency):** `npm install server-only` — added to `dependencies` in `package.json`.
- **Step 3 (new module):** Created `src/lib/request-ip.ts` with `getRequestIp(hdrs)` implementing the three-tier precedence from DECISION-017 (`cf-connecting-ip` → `x-forwarded-for` with TRUST_PROXY_HEADERS gate → `x-real-ip`).
- **Step 4 (rate-limit refactor):** Removed local `getRequestIp` function and `ReadonlyHeaders` import from `src/lib/rate-limit.ts`; added `import { getRequestIp } from "@/lib/request-ip"`. Also updated `src/auth.ts` (imports `getRequestIp` from rate-limit) and `src/lib/rate-limit.test.ts` (imports `getRequestIp` from `@/lib/request-ip`). No re-export from rate-limit per design.
- **Step 5 (audit.ts extension):** Added `import "server-only"` as first line. Added imports for `headers`, `auth`, `db`, `auditEvents`, `getRequestIp`. Added `AuditActorOverride`, `RecordAuditInput`, and `recordAudit()` with inner try-catch for headers() and outer try-catch with `console.error`.
- **Steps 6-9 (call site migration — 20 sites across 8 files):**
  - Admin batch (Step 6): `admin/flags/actions.ts` (1), `admin/2fa/actions.ts` (3), `admin/users/actions.ts` (4), `admin/users/[id]/actions.ts` (2). Omitted actor (default `auth()`). check:audit passed after batch.
  - Account batch (Step 7): `account/2fa/actions.ts` (2), `account/actions.ts` (5). Omitted actor. check:audit passed.
  - Password-reset (Step 8): `(password-reset)/actions.ts` (2). Explicit `actor: { userId: userRow.id, email: userRow.email }`. Updated `getRequestIp` import from `@/lib/rate-limit` to `@/lib/request-ip`. check:audit passed.
  - TOTP (Step 9): `(auth)/totp/actions.ts` — eliminated `logAttempt()` helper entirely; inlined 5 `recordAudit()` calls with `actor: { userId: session.user.id, email: session.user.email ?? null }` (explicit, avoids redundant `auth()` call — Gap 5 resolution). check:audit passed.
- **Step 10 (tests):**
  - Created `src/lib/request-ip.test.ts` — 15 test cases covering all three precedence tiers, TRUST_PROXY_HEADERS on/off, trim behavior, and null fallback.
  - Extended `src/lib/audit.test.ts` — added `vi.mock("server-only")` and mocks for `@/auth`, `next/headers`, `@/lib/db`, `@/lib/db/schema`, `@/lib/request-ip`; added 13 new test cases for `recordAudit()` covering actor resolution (undefined/explicit/null), ip/user-agent extraction, headers() failure graceful handling, db failure swallowing with `console.error`, and metadata passthrough.
  - Updated `src/lib/rate-limit.test.ts` — changed import of `getRequestIp` from `./rate-limit` to `@/lib/request-ip`.
  - Added `vi.mock("server-only")`, `vi.mock("@/auth")`, and `vi.mock("@/lib/db")` to `src/app/(admin)/admin/users/[id]/actions.test.ts` and `src/app/(password-reset)/password-reset-actions.test.ts` — both do `await import("@/lib/audit")` and would throw without these mocks.
- **Step 11 (full verification):** `npm run typecheck` — clean. `npm run build` — clean. `npm run test` — 222 passed. `npm run check:audit` — passed.
- **Step 12 (e2e gate):** Dev server started on port 3000. `npm run test:e2e` — 20/20 passed. Server killed.

### Outputs

**New files:**
- `src/lib/request-ip.ts` — canonical IP extraction, three-tier precedence (DECISION-017)
- `src/lib/request-ip.test.ts` — 15 unit tests for `getRequestIp()`

**Modified files:**
- `scripts/check-audit-coverage.mjs` — AUDIT_RE updated to accept `recordAudit`
- `package.json` / `package-lock.json` — `server-only` added to dependencies
- `src/lib/audit.ts` — `import "server-only"`, types, and `recordAudit()` added
- `src/lib/audit.test.ts` — extended with `recordAudit()` tests (13 new cases)
- `src/lib/rate-limit.ts` — local `getRequestIp` removed; imports from `@/lib/request-ip`
- `src/lib/rate-limit.test.ts` — `getRequestIp` import updated to `@/lib/request-ip`
- `src/auth.ts` — `getRequestIp` import updated from rate-limit to request-ip
- `src/app/(auth)/totp/actions.ts` — `logAttempt()` eliminated; 5 inline `recordAudit()` calls
- `src/app/(account)/account/2fa/actions.ts` — 2 inserts → `recordAudit()`
- `src/app/(account)/account/actions.ts` — 5 inserts → `recordAudit()`
- `src/app/(password-reset)/actions.ts` — 2 inserts → `recordAudit()` with explicit actor; `getRequestIp` import updated
- `src/app/(admin)/admin/flags/actions.ts` — 1 insert → `recordAudit()`
- `src/app/(admin)/admin/2fa/actions.ts` — 3 inserts → `recordAudit()`
- `src/app/(admin)/admin/users/actions.ts` — 4 inserts → `recordAudit()`
- `src/app/(admin)/admin/users/[id]/actions.ts` — 2 inserts → `recordAudit()`
- `src/app/(admin)/admin/users/[id]/actions.test.ts` — vi.mock stubs for server-only/auth/db
- `src/app/(password-reset)/password-reset-actions.test.ts` — vi.mock stubs for server-only/auth/db
- `docs/work-log/2026-07-01-record-audit-helper.md` — this section
- `docs/TODO.md` — recordAudit In Flight line updated to Phase 5

**API contracts for qa (Phase 5):**

No new route handlers or server actions exposed. The API-facing changes are internal:
- `recordAudit(input: RecordAuditInput): Promise<void>` — exported from `src/lib/audit.ts`
- `getRequestIp(hdrs: ReadonlyHeaders | Headers): string | null` — exported from `src/lib/request-ip.ts`

**check:audit trajectory:**

| Step | Migration batch | check:audit result |
|------|-----------------|-------------------|
| 1 | None (tripwire updated only) | PASS |
| 6 | Admin batch (10 sites) | PASS |
| 7 | Account batch (7 sites) | PASS |
| 8 | Password-reset batch (2 sites) | PASS |
| 9 | TOTP batch (5 sites) | PASS |

**Verification results:**
- `npm run typecheck` — clean (0 errors)
- `npm run build` — clean (17 routes generated)
- `npm run test` — 222 passed, 0 failed, 0 skipped
- `npm run check:audit` — passed
- `npm run test:e2e` (dev server running) — 20/20 passed

### Deviations from design

1. **`src/auth.ts` required an import update.** `auth.ts` imported `getRequestIp` from `@/lib/rate-limit`. After removing the export from rate-limit, this had to be updated to `@/lib/request-ip`. The design spec identified `password-reset/actions.ts` as the only caller to update; `auth.ts` was an additional caller not mentioned. The update is structurally identical and correct.

2. **Two pre-existing test files required new vi.mock stubs.** `(admin)/admin/users/[id]/actions.test.ts` and `(password-reset)/password-reset-actions.test.ts` both do `await import("@/lib/audit")` inside test bodies. After `audit.ts` gained `import "server-only"` and transitive loading of `@/auth` and `@/lib/db`, these imports throw without mocks. Added minimal stubs for `server-only`, `@/auth`, and `@/lib/db` to both files. The tests themselves (AUDIT_ACTIONS catalog assertions) are unchanged and still test the real module values.

3. **Implementation order deviation: `src/auth.ts` was updated in Step 4 (not a numbered step in the design).** The design said to update `password-reset/actions.ts` getRequestIp import in Step 8. The `src/auth.ts` import issue was discovered during Step 4 typecheck and fixed immediately to keep typecheck clean at every step.

### Open questions / handoff notes

For **qa** (Phase 5):

- The e2e gate was satisfied: 20/20 tests passed against a dev server. The MFA enrollment smoke is covered by `e2e/member-home.spec.ts:93:7` (user with `twoFactorRequired=true` is redirected to `/totp`), which exercises the full `totp/actions.ts` path that was migrated.
- Unit tests for `recordAudit()` mock the db and auth — they do not hit a real database. Integration confidence comes from the build (Next.js successfully renders all 17 routes including `/totp`) and the e2e suite.
- There is no admin UI displaying `ip` or `user_agent` from `audit_events` yet. The columns will be populated in production after this PR, but the values are invisible until an audit viewer is built. The follow-up is tracked in `docs/TODO.md` backlog: "Audit log viewer under /admin/audit".
- Next agent: **qa** for Phase 5 verification.

---

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS. All shared and pipeline-specific verification checks passed. The auth-touching e2e gate is satisfied: a live dev-server run produced 24/24 passing Playwright tests, including the TOTP redirect assertion at `e2e/member-home.spec.ts:93:7`, which exercises the migrated `totp/actions.ts` path. `recordAudit()` is correctly wired, the tripwire accepts `recordAudit`, the two non-migration sites are intact, and the three-tier IP precedence is fully unit-tested.

### What I did

- Ran `npm run typecheck` — clean (0 errors).
- Ran `npm run lint` — clean (0 warnings).
- Ran `npm run test` — 259 passed across 23 test files (including 15 new audit/request-ip tests).
- Ran `npm run check:audit` — PASS.
- Ran `npm run build` — clean; 20 routes including `/api/cron/email-queue`.
- Ran `npx playwright test` against live dev server on port 3000 — 24/24 passed (22.3s). globalSetup issued the expected local DB guard warning; all three `.auth/*.json` files were fresh (TTL hit). This run satisfies the CLAUDE.md auth-touching e2e gate.
- Confirmed `logAttempt()` helper is eliminated from `totp/actions.ts` — only `recordAudit` references at lines 67, 79, 92, 110, 122.
- Confirmed `verify-email/[token]/page.tsx` still uses direct `db.insert(auditEvents)` inside `db.batch()` — DECISION-014 non-migration preserved.
- Confirmed `rate-limit.ts` fire-and-forget insert is untouched.
- Confirmed `src/lib/request-ip.ts` three-tier precedence: `cf-connecting-ip` → `x-forwarded-for` (TRUST_PROXY_HEADERS gate) → `x-real-ip`. `rate-limit.ts` imports from `@/lib/request-ip` (line 35); `src/auth.ts` imports from `@/lib/request-ip` (line 21). No local copy remains in `rate-limit.ts`.
- Ran `src/lib/request-ip.test.ts` (15 tests) and `src/lib/audit.test.ts` (13 new + 4 catalog = 17 tests) — all passed.
- Coverage on critical modules (with `--coverage.include` targeting): `src/lib/permissions.ts` 100%, `src/lib/two-factor.ts` 100%, `src/lib/flags.ts` 100%, `src/lib/audit.ts` 100%, `src/lib/request-ip.ts` 100% statements / 90% branches (uncovered: line 31 — XFF empty-after-split guard, minor edge not worth a dedicated test).

### Feature-Gate Audit

No new protected routes or server actions added. All 8 migrated `actions.ts` files retained their existing session/permission guards. The `verify-email/[token]/page.tsx` is intentionally unauthenticated — no gate change. The `rate-limit.ts` audit write is exempt by documented design.

No protected routes touched — feature-gate audit not applicable beyond confirming no gates were removed from migrated files (confirmed).

### Outputs

- `docs/work-log/2026-07-01-record-audit-helper.md` — Phase 5 section added; Per-Phase Status row updated.
- `docs/TODO.md` — In Flight entry updated to Phase 6 next.

### Open questions / handoff notes

- Next agent: **analyst** for Phase 6 shipped-vs-intent review.
- No admin UI displays `ip` or `user_agent` today; columns are being populated. Audit viewer follow-up tracked in `docs/TODO.md` backlog.

---

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. The shipped code matches the Phase 1 intent on every axis: 20 call sites across 8 actions.ts files migrated to recordAudit(), two deliberate non-migrations preserved intact, IP-extraction consolidated into a single shared module, check:audit tripwire updated and passing, logAttempt() helper eliminated, server-only guard enforced at build time. The audit log will now receive ip and user_agent on every security-sensitive mutation that flows through the migrated call sites.

### What I did

- Verified `src/lib/audit.ts`: `import "server-only"` is first line; `recordAudit()` implemented with inner try-catch for headers() and outer try-catch with `console.error`; actor resolution matches the three-case spec (undefined → auth(); object → explicit; null → system write).
- Verified `src/lib/request-ip.ts`: three-tier precedence (cf-connecting-ip → xff with TRUST_PROXY_HEADERS gate → x-real-ip) matches DECISION-017 spec exactly.
- Verified `src/lib/rate-limit.ts` line 35: imports `getRequestIp` from `@/lib/request-ip` — no local copy remains.
- Verified `src/auth.ts` line 21: imports `getRequestIp` from `@/lib/request-ip` — the additional caller the design spec missed; api-developer caught and fixed this correctly.
- Verified `src/app/(auth)/totp/actions.ts`: no `logAttempt()` helper present; 5 inline `recordAudit()` calls with `actor: { userId: session.user.id, email: session.user.email ?? null }` explicitly set (Gap 5 resolution confirmed).
- Verified `scripts/check-audit-coverage.mjs` line 36: `AUDIT_RE = /\bauditEvents\b|\brecordAudit\b/` — tripwire accepts both patterns.
- Verified `src/app/(email-verify)/account/verify-email/[token]/page.tsx`: `db.insert(auditEvents)` remains inside `db.batch()` — non-migration per DECISION-014 confirmed.
- Confirmed `src/lib/rate-limit.ts` fire-and-forget insert untouched.
- Confirmed action key values unchanged across migrated files (spot-checked `AUDIT_ACTIONS.USER_DEACTIVATED`, `AUDIT_ACTIONS.TOTP_VERIFY_FAILED` — identical string values, no metadata shape change).

### Outputs

- `docs/work-log/2026-07-01-record-audit-helper.md` — Phase 6 section added; Per-Phase Status row updated to Complete / SHIP IT / 2026-07-01.
- `docs/TODO.md` — In Flight line moved to Done.

### Intent-vs-shipped diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| recordAudit() populates ip and user_agent on every migrated call site | 20 call sites across 8 files migrated; inner try-catch for headers() gracefully handles non-request context | matches |
| Single IP-extraction source of truth (request-ip.ts) | request-ip.ts created; rate-limit.ts, auth.ts, and audit.ts all import from it; no local copies remain | matches |
| No action key or metadata shape changes | AUDIT_ACTIONS keys unchanged; metadata passed through verbatim from every call site | matches |
| check:audit tripwire passes after migration | AUDIT_RE updated to /\bauditEvents\b|\brecordAudit\b/; check:audit PASS confirmed | matches |
| Two deliberate non-migrations (verify-email batch, rate-limit.ts) | Both confirmed intact on direct file inspection | matches |
| logAttempt() eliminated; 5 inline recordAudit() calls with explicit actor | No logAttempt() helper in totp/actions.ts; 5 inline calls found with explicit actor object | matches |
| server-only guard (build-time enforcement) | import "server-only" is first line of audit.ts | matches |
| Swallow failures with console.error | Outer try-catch logs console.error("[audit] failed to write event", input.action, err) | matches |
| auth.ts import update not in design spec | Implementer identified and updated in Step 4 (deviation note in Phase 4) | acceptable deviation — correct fix |

### Edge cases

| Check | Result |
|---|---|
| Empty state | not applicable — no UI surface |
| Failure microcopy | pass — audit failures are console.error only; no user-facing string changes |
| Permission gate | not applicable — no new permission; all existing gates on migrated call sites preserved |
| Audit event | pass — ip and user_agent now populated on all 20 migrated call sites; verify-email batch write still atomically protected |
| Mobile | not applicable |

### Open questions / handoff notes

- Audit log viewer under /admin/audit remains a tracked follow-up in `docs/TODO.md` Backlog. The columns are now populated in production; the value is latent until the viewer is built.
- No open blockers. Pipeline closed.
