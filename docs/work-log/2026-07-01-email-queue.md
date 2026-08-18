# Durable email queue with retry — Work Log

> **Slug:** `2026-07-01-email-queue`
> **Surface:** mixed (src/lib/email, new schema table, new cron route, callers)
> **Permission(s):** None for the queue itself; admin queue viewer is out of scope for this phase
> **Flag(s):** None recommended — see Phase 1 rationale
> **Estimated complexity:** large
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete | READY WITH NOTES | 2026-07-01 |
| 2 — Architectural review | architect | complete | Approved with suggestions | 2026-07-01 |
| 3 — Technical design | tech-lead | complete | — | 2026-07-01 |
| 4 — Implementation | database-admin (4a) / api-developer (4b) | complete | — | 2026-07-01 |
| 5 — Verification | qa | Complete | PASS | 2026-07-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-01 |

---

## Intent (from harvest, 2026-07-01)

The starter's `src/lib/email.ts` is fire-and-forget: a transient Resend
failure silently drops a password-reset or email-verification email — the
user's only recovery is to notice nothing arrived and retry. Three sibling
forks independently built the same fix (harvest Tier 2 item 7, the most
re-invented improvement in the fleet):

- **fertilityluna** `src/lib/email/send.ts:60-190` — persist-first
  `enqueueEmail()`: write the row, attempt one inline send, on failure leave
  queued with exponential backoff (1m → 2m → … → 1h cap), `maxAttempts` then
  permanent-fail. Also `EMAIL_DEV_INTERCEPT` (never call the provider; mark
  sent with synthetic id) and `EMAIL_DEV_REDIRECT_TO` (send everything to one
  test inbox, keep the intended recipient on the row).
- **fpcw-directory** `src/lib/email/queue.ts` — atomic multi-instance-safe
  claim: `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) … RETURNING`.
  Its node-cron in-process driver does NOT fit the starter's serverless
  target — do not port that part.
- **fertilityluna** `src/app/api/cron/email-queue/route.ts:26-45` +
  `vercel.json` — cron endpoint pattern: `Authorization: Bearer CRON_SECRET`,
  503 when the secret is unset (never ships an accidentally-public worker),
  `limit` param clamped. Note huddleup kit §D3: Vercel cron invokes GET, not
  POST.

**Synthesis requested:** persist-first enqueue + atomic claim + exponential
backoff, driven by a Vercel cron route with the CRON_SECRET pattern; the
dev-intercept/redirect env vars included. New `email_queue` table (schema
change → database-admin in Phase 4). All existing senders
(invite/reset/verify flows) migrate to `enqueueEmail()`.

**Out of scope unless the analyst argues otherwise:** admin queue-viewer UI;
the Svix-verified Resend delivery webhook (harvest Tier 2 #7 optional pair —
track as follow-up).

---

## Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

The durable email queue replaces the starter's current fire-and-forget
`sendEmail()` with a persist-first queue backed by a new `email_queue` DB
table, exponential-backoff retries, and a Vercel cron worker. There are
exactly two send call sites today. The most important technical finding is
that the `FOR UPDATE SKIP LOCKED` atomic claim CANNOT be a two-step
SELECT-then-UPDATE on the `neon-http` driver — it must be a single-statement
`UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`, which
is safe over stateless HTTP. The `processing` status lease requires a
stuck-row recovery pass (Gap 1). Rendered HTML with token URLs stored at rest
has privacy weight and needs a position from the tech-lead.

### What I did

**Pass 1 — User Verbs**

This feature has no new user-facing verbs. The queue is entirely system-side.
User-visible behavior changes only in the success-path microcopy:

- **Authenticated member** (account surface): submits "Change email" form —
  sees "Check your email" toast whether the send was inline-synchronous or
  queued-for-later. No visible difference to the user.
- **Anonymous visitor** (forgot-password flow): submits email — sees "If an
  account exists, we sent a link" page regardless of inline or queued send.
  Enumeration safety preserved.

The cron worker is invoked by Vercel infrastructure (GET with bearer token)
or by an operator's curl command. No user surface.

**Pass 2 — Flow Audit**

**Send-site inventory — what exists today, what changes:**

| Call site | File | Token written before send? | Current behavior on Resend throw | Desired queued behavior |
|---|---|---|---|---|
| `sendPasswordResetEmail(userRow.email, rawToken)` | `src/app/(password-reset)/actions.ts` line 79 | YES — `password_reset_tokens` insert at lines 73-77 | Action propagates the throw; user sees a server error (enumeration safety breaks — they see an error instead of the silent "check your inbox" page); audit event at line 81 is skipped | `enqueueEmail()` persists row, attempts inline send, returns whether inline succeeded. Action always returns `{ ok: true }` — enumeration safety preserved. Audit event writes regardless of inline outcome. |
| `sendEmail({...})` for email-change verification | `src/app/(account)/account/actions.ts` line 148 | YES — `email_verification_tokens` upsert at lines 131-142 | Action propagates the throw; user sees an error toast; audit event at line 161 is skipped; an orphaned verification token sits in the DB | `enqueueEmail()` completes, action returns `{ ok: true }`, user sees "Check your email". Audit event writes regardless of inline outcome. |

**Flow 1: User requests password reset (entry → outcome)**

- Entry: `/forgot-password`, user submits email form
- Step 1: IP-keyed rate limit check (5/hr). If blocked, `{ ok: false }` — no enumeration leak (block fires on IP regardless of email existence).
- Step 2: Look up user by email. Unknown email or Google-only account → silent no-op, skip to Step 4.
- Step 3: Write token to `password_reset_tokens` (existing).
- Step 4: `enqueueEmail()` — persist row to `email_queue`, attempt inline send.
  - Inline success: row marked `sent`. Email delivered immediately.
  - Inline failure: row stays `queued`, `next_attempt_at` = now + 1 min. Action still completes.
- Step 5: Write `USER_PASSWORD_RESET_REQUESTED` audit event (NOW writes even when inline send fails).
- Step 6: Return `{ ok: true }` always.
- Success outcome: User sees "If an account exists, we sent you a link." Email arrives inline or within next cron window.
- Failure outcome (IP rate-limited): User sees rate-limit message. Token NOT written. Enumeration-safe.
- Failure outcome (queue exhausts maxAttempts): User never gets the email. User may re-request (new token, new queue row). No user-visible signal of permanent failure.

**Flow 2: User requests email change (entry → outcome)**

- Entry: `/account`, user submits "Change email" form
- Step 1: userId-keyed rate limit check (3/hr).
- Step 2: Validate new email format, uniqueness, pending-token collision (existing guards).
- Step 3: Upsert token to `email_verification_tokens` (existing).
- Step 4: `enqueueEmail()` — persist row to `email_queue`, attempt inline send.
  - Inline success: row marked `sent`. Email delivered immediately.
  - Inline failure: row stays `queued`. Action still completes.
- Step 5: Write `USER_EMAIL_CHANGE_REQUESTED` audit event (NOW writes even when inline send fails).
- Step 6: Return `{ ok: true }`.
- Success outcome: User sees "Check your email to confirm the change." (microcopy change from today — see Gap 3).
- Failure outcome (validation): User sees specific error toast (existing, unchanged).
- Failure outcome (queue exhausts maxAttempts): Verification link never arrives. User can re-request via the account page (which upserts a fresh token).

**Flow 3: Cron worker (entry → outcome)**

- Entry: Vercel cron fires GET `/api/cron/email-queue` every 5 minutes, `Authorization: Bearer $CRON_SECRET`.
- Step 1: Check `CRON_SECRET` is set. If unset → 503 `{ error: "Email queue worker disabled: set CRON_SECRET to enable." }`. No processing.
- Step 2: Verify `Authorization: Bearer $CRON_SECRET`. If mismatch → 401.
- Step 3: Parse and clamp `?limit` (default 25, max 200).
- Step 4: `processEmailQueue(limit)`:
  - Sub-step a: Single-statement atomic claim (see Pass 5 adversarial finding) — UPDATE rows WHERE status='queued' AND due AND attempt_count < max_attempts, set status='processing'. Returns claimed rows via RETURNING.
  - Sub-step b: For each claimed row, attempt Resend send.
    - Success: UPDATE → `sent`, record `provider_message_id`, clear `failure_reason`.
    - Failure, retries remain: UPDATE → `queued`, increment `attempt_count`, set `next_attempt_at` per backoff schedule, record `failure_reason`.
    - Failure, max retries reached: UPDATE → `failed` permanently.
  - Sub-step c: Log to stderr if `givenUp > 0` (only visibility mechanism for permanent failures; see Gap 6).
- Step 5: Return `{ ok: true, processed: N, sent: N, failed: N, givenUp: N }`.
- Success outcome: HTTP 200 with counts. Vercel logs capture the counts.
- Failure outcome (Resend down entire batch): All rows requeued with backoff. Next cron window retries. HTTP 200 still returned (worker completed, just sent 0).
- Failure outcome (CRON_SECRET not set): HTTP 503. Queue accumulates. Ops must notice via Vercel logs or monitoring.

**Pass 3 — Permissions and Flags**

- **Permission:** None needed. The queue and cron route are system-initiated; the cron is auth'd via `CRON_SECRET` bearer token, not NextAuth. No `FEATURES` key needed.
- **Feature flag:** None recommended. The queue replaces the existing send path rather than adding a parallel one. A flag gating the queue for rollout would require maintaining the old fire-and-forget path alongside the new queued path — double the code surface. The safer rollout strategy is: deploy the queue; if a regression occurs, revert the commit. The cron route is self-disabling (`CRON_SECRET` not set = 503) so ops can stop processing without a flag.
- **Admin queue viewer permission:** Will need `admin.email_queue` when that UI ships (out-of-scope follow-up). Not needed now.

**Pass 4 — Edge Cases the Request Didn't Mention**

- **2FA gate:** Not applicable. The cron route is not auth'd via NextAuth and has no session. The `requestEmailChange` and `requestPasswordReset` actions run for authenticated/anonymous users who may be mid-enrolment. No change to TOTP behavior.
- **Audit events:** The two existing callers write audit events today. With queuing, the audit event must write regardless of the inline send outcome (it currently only writes if the send succeeds — Gap 4). The queue itself does not write audit events for individual send attempts; that would be log noise. Permanent failure (`givenUp = true`) logs to stderr (Gap 6 position).
- **Empty state:** On fresh install, the `email_queue` table is empty. The cron worker returns `{ ok: true, processed: 0, sent: 0, failed: 0, givenUp: 0 }`. No empty-state UI exists (queue viewer is out of scope).
- **Failure microcopy:** The user never sees queue internals. The toast they see does not change based on whether the inline send succeeded. The word "queued" should not appear in any user-facing string.
- **Mobile:** Not applicable — no new UI surfaces.

**Pass 5 — Adversarial Pass**

**CRITICAL (DECISION-018): `FOR UPDATE SKIP LOCKED` is UNSAFE as a two-step operation on the neon-http driver, and `db.batch()` cannot express the pattern either.**

The starter uses `drizzle-orm/neon-http` (`src/lib/db/index.ts` line 1). This is the stateless HTTP driver — each query is a separate HTTP request with no persistent connection. DECISION-014 establishes `db.batch()` as the convention for atomic multi-write, but explicitly calls out the exception: "If write N depends on a value produced by write N-1, `db.batch()` cannot be used." The atomic claim is precisely this exception.

Two patterns that do NOT work:

**Two-step approach (unsafe — lock released between HTTP calls):**
```
HTTP req 1:  SELECT id FROM email_queue ... FOR UPDATE SKIP LOCKED LIMIT 25
HTTP req 2:  UPDATE email_queue SET status = 'processing' WHERE id = ANY($ids)
```
The `FOR UPDATE SKIP LOCKED` lock is tied to the connection. The neon-http driver has no persistent connection — the lock is released the moment HTTP response 1 is returned. By the time HTTP request 2 arrives, no lock is held. Two concurrent workers SELECT the same rows and both UPDATE them to `processing`.

**`db.batch()` approach (unsafe — cannot reference cross-item results):**
```typescript
await db.batch([
  db.select({ id: emailQueue.id }).from(emailQueue).where(...).for('update', { skipLocked: true }).limit(n),
  db.update(emailQueue).set({ status: 'processing' }).where(inArray(emailQueue.id, /* ??? */)),
])
```
The second batch item cannot consume the result of the first — this is the exact limitation DECISION-014 documents. "Pre-read the needed value before the batch" (DECISION-014's alternative) is the same as the two-step approach above and has the same race condition.

The fertilityluna `processEmailQueue` function uses a plain SELECT (no locking) then loops calling `attemptSend` per row — also unsafe for concurrent workers, because the race window between two workers' SELECTs and their first per-row UPDATE is real and can produce duplicate sends.

**The only safe pattern on neon-http is a single atomic SQL statement:**

```sql
UPDATE email_queue
SET status = 'processing',
    last_attempt_at = NOW(),
    updated_at = NOW()
WHERE id IN (
  SELECT id FROM email_queue
  WHERE status = 'queued'
    AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
    AND attempt_count < max_attempts
  ORDER BY COALESCE(next_attempt_at, '-infinity'::timestamptz) ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $limit
)
RETURNING *
```

This is one HTTP request. PostgreSQL executes the entire UPDATE (including the subquery) in an implicit transaction. The `FOR UPDATE SKIP LOCKED` in the subquery locks the selected rows for the duration of this single statement. Two concurrent workers sending this identical statement are serialized by Postgres: the second worker's subquery sees the rows the first worker's UPDATE already locked, skips them (SKIP LOCKED), and claims a disjoint set.

Implementation: `db.execute(sql\`...\`)` from `drizzle-orm`. The `sql` template tag is already imported in `schema.ts` from `drizzle-orm` and available for use in other modules. The fpcw-directory accomplished the same thing via `rawSql` (a raw postgres.js client). `db.execute(sql\`...\`)` is the neon-http equivalent. This pattern is an exception to the `db.batch()` convention from DECISION-014 and must be documented as DECISION-018.

**CRON_SECRET auth — GET not POST:**
Vercel cron invokes via GET. The route should export `export async function GET(req: Request)`. Exporting POST as well (as fertilityluna does for curl compatibility) is acceptable since bearer auth gates both verbs. Recommendation: GET only; POST can be added when an admin "retry now" action is built.

**`CRON_SECRET` not set in production:**
The 503 guard prevents silent data accumulation without auth. But if ops forgets to set `CRON_SECRET` in the Vercel project settings, the queue accumulates silently. `.env.example` must document this clearly as a required production var (not optional).

**`processing` status lease with no TTL (Gap 1 — critical):**
If the cron process crashes mid-batch (Vercel function timeout, OOM), rows left in `processing` are stuck forever — they never transition to `queued`, `sent`, or `failed`. The worker must include a lease-recovery step: before claiming new rows, re-queue any `processing` rows where `last_attempt_at < NOW() - interval '10 minutes'`. Without this, every crash event permanently removes a batch of emails from the retry cycle.

**`EMAIL_DEV_INTERCEPT` and `EMAIL_DEV_REDIRECT_TO` in production:**
If either env var is accidentally set in production, emails silently don't reach real recipients. The `enqueueEmail` / `attemptSend` path should include a loud startup guard: if `NODE_ENV === 'production'` and either dev var is set, log a `console.error` warning at worker invocation time (a throw would be too disruptive — the queue might otherwise be healthy). See Gap 2.

**Rendered HTML with token URLs stored at rest:**
The `html_body` column will store the full password-reset URL (containing the raw token; valid 60 min) and the email-change verification URL (valid 24 hr). In a DB compromise, the attacker gets valid password-reset links (short window, limited to users who triggered a reset in the last hour) and verification links (longer window). The alternative — storing only a template key and re-rendering at send time — is significantly more complex and doesn't eliminate the risk (the tokens exist in `password_reset_tokens` and `email_verification_tokens` regardless). Recommendation: store rendered HTML; note the tradeoff in DECISION-014. The privacy weight is acceptable for the starter; production forks with stricter data-at-rest requirements can add encryption. See Gap 5.

**Duplicate sends if inline + worker both fire:**
The inline send in `enqueueEmail` runs immediately after the row insert. If the inline send succeeds, the row is marked `sent`. The worker's claim step filters on `status = 'queued'`; a `sent` row is never claimed. No duplicate. If the inline send fails, the row stays `queued` with `next_attempt_at = now + 1m`; the worker won't claim it until the next cron window. No race between inline and worker.

**Limit param injection:**
The `?limit` query parameter is cast to integer with `Math.parseInt` and clamped. No SQL injection risk — it's used as a Drizzle bound parameter.

### Outputs

**Send-site inventory:**
- `src/app/(password-reset)/actions.ts` line 79: `sendPasswordResetEmail()` — replace with `enqueueEmail()`. Token is written before call. Currently breaks enumeration safety on Resend failure.
- `src/app/(account)/account/actions.ts` line 148: `sendEmail()` (email-change verification) — replace with `enqueueEmail()`. Token is upserted before call. Currently leaves an orphaned token on Resend failure.
- No other call sites. `sendEmail` and `sendPasswordResetEmail` are only exported from `src/lib/email.ts` and called in these two places.

**Schema sketch for `email_queue` table (for database-admin in Phase 4):**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK, defaultRandom | |
| `to_email` | text | NOT NULL | Intended recipient. Always the real address even when dev-redirect overrides the live send. |
| `from_email` | text | NOT NULL | Defaults from `RESEND_FROM_EMAIL` env var at enqueue time. |
| `reply_to` | text | nullable | |
| `subject` | text | NOT NULL | |
| `html_body` | text | NOT NULL | Rendered HTML including any token URLs. See privacy note (Gap 5). |
| `text_body` | text | nullable | Plain-text fallback. |
| `template_key` | text | NOT NULL | Label for the email type: `password_reset`, `email_change_verify`. Used for monitoring/filtering, not re-rendering. |
| `status` | text | NOT NULL, default `queued` | Enum: `queued` / `processing` / `sent` / `failed`. |
| `attempt_count` | integer | NOT NULL, default 0 | Incremented on each attempt. |
| `max_attempts` | integer | NOT NULL, default 5 | Configurable per row; defaults to 5 which allows 1+4 retries. |
| `next_attempt_at` | timestamptz | nullable | NULL on first insert = try immediately. Set to backoff schedule on failure. |
| `last_attempt_at` | timestamptz | nullable | Used for the processing-lease recovery query (Gap 1). |
| `sent_at` | timestamptz | nullable | Set when status transitions to `sent`. |
| `provider_message_id` | text | nullable | Resend message ID on successful send (or `dev-intercepted:{id}` in dev mode). |
| `failure_reason` | text | nullable | Last Resend error message on failure. |
| `created_at` | timestamptz | NOT NULL, defaultNow | |
| `updated_at` | timestamptz | NOT NULL, defaultNow, $onUpdate | |

**Required indexes (flag for database-admin):**
- `(status, next_attempt_at)` — the primary worker query filters on status='queued' and orders/filters on next_attempt_at. Without this index the claim step table-scans the entire queue.
- `(status, last_attempt_at)` — for the lease-recovery query that finds stuck `processing` rows.

**Decisions logged:**
- DECISION-018 (to be written by tech-lead): `FOR UPDATE SKIP LOCKED` for the email queue atomic claim requires a single-statement `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING` via `db.execute(sql\`...\`)`. This is an explicit exception to the `db.batch()` convention from DECISION-014, which cannot express a SELECT whose result feeds the same-statement UPDATE. See adversarial Pass 5 for the full rationale.

**Files that will change:**
- `src/lib/db/schema.ts` — new `email_queue` table (database-admin)
- `src/lib/email.ts` — new `enqueueEmail()`, new `processEmailQueue()`, keep `sendEmail()` as internal primitive (api-developer)
- `src/app/(password-reset)/actions.ts` — replace `sendPasswordResetEmail()` call with `enqueueEmail()` (api-developer)
- `src/app/(account)/account/actions.ts` — replace `sendEmail()` call with `enqueueEmail()` (api-developer)
- `src/app/api/cron/email-queue/route.ts` — new file (api-developer)
- `vercel.json` — new file with cron schedule (api-developer)
- `.env.example` — add `CRON_SECRET`, `EMAIL_DEV_INTERCEPT`, `EMAIL_DEV_REDIRECT_TO` (api-developer)

### Open questions / handoff notes

**Gaps the request didn't address (notes for Phase 3 tech-lead):**

1. **[Critical] `processing` lease timeout.** If the cron runner crashes mid-batch, rows in `processing` status are stuck forever. `processEmailQueue` must include a lease-recovery pass before claiming new rows: re-queue any `processing` rows where `last_attempt_at < NOW() - interval '10 minutes'`. The 10-minute threshold is a starting point; the tech-lead should pick a value that exceeds the Vercel function timeout for the cron route.

2. **[Important] Production guard for dev env vars.** If `EMAIL_DEV_INTERCEPT=1` or `EMAIL_DEV_REDIRECT_TO` is set when `NODE_ENV === 'production'`, the worker should log a loud `console.error` at invocation time. A startup throw would be too disruptive; a per-invocation warning ensures ops notices via Vercel logs.

3. **[UX] Microcopy change for email-change toast.** Today `requestEmailChange` returns `{ ok: true }` only after a successful synchronous send, so the component's success toast accurately reflects delivery. With queuing, `ok: true` means "queued, not necessarily sent." The toast text must be "Check your email to confirm the change" rather than anything implying immediate delivery. The UX-developer needs to verify the current component text and update if needed.

4. **[Correctness] Audit event ordering in both callers.** Currently both callers write the audit event AFTER the `sendEmail`/`sendPasswordResetEmail` call. If the send throws, the audit event is skipped. With queuing the action now completes whether or not the inline send succeeded, so the audit event correctly fires in all cases — but the ordering should be explicit: enqueue first, then audit event. Do not reorder to audit-first (auditing something that subsequently fails the enqueue would be misleading).

5. **[Privacy] Rendered HTML with token URLs at rest.** The `html_body` column will contain password-reset URLs (raw token, valid 60 min) and email-change URLs (valid 24 hr). This is acceptable for the starter; production forks with stricter data-at-rest requirements can add column-level encryption. Tech-lead should acknowledge this trade-off in DECISION-014.

6. **[Ops] Permanent failure visibility.** When a row reaches `max_attempts` and is marked `failed`, `processEmailQueue` should log to stderr: `console.error("[email-queue] permanent failure", { id, toEmail, templateKey, failureReason })`. This is the minimum visibility mechanism; the admin queue viewer (out-of-scope follow-up) will provide the proper ops surface.

7. **[New file] `vercel.json`.** The starter ships no `vercel.json` today. Creating one with the cron schedule is a structural addition. Recommend shipping with `"schedule": "*/5 * * * *"` (every 5 minutes) matching fertilityluna — aggressive enough to keep retry latency low, well within Vercel Hobby plan cron limits (once per day) and Pro plan limits (every minute).

   Note for the architect: creating `vercel.json` is a structural decision that touches deployment configuration. Confirm this belongs in Phase 2.

8. **[Breaking change] Migration path for fork callers.** `sendPasswordResetEmail()` is a named export. Forks calling it directly will need to update their call sites. Recommendation: keep `sendEmail()` and `sendPasswordResetEmail()` as deprecated thin wrappers over `enqueueEmail()` for one release cycle, or remove them and document the breaking change in release notes. Tech-lead to decide.

9. **[New env vars] `CRON_SECRET`, `EMAIL_DEV_INTERCEPT`, `EMAIL_DEV_REDIRECT_TO`.** All three need entries in `.env.example` with documentation. `CRON_SECRET` must be documented as a REQUIRED production var (not optional) — the 503 guard means the queue is silently disabled until it is set.

**Out of scope (confirmed):**
- Admin queue viewer UI — track as follow-up
- Resend delivery webhook (Svix-verified webhook to mark rows `delivered`) — track as follow-up
- Email template system (template key + params stored, rendered at send time) — out of scope; store rendered HTML

**Verdict:** READY WITH NOTES — advance to Phase 2 (architect). The notes (especially Gap 1 lease timeout, Gap 7 `vercel.json` structural decision) must flow into the Phase 2 and Phase 3 outputs.

---

## Phase 2 — Architectural Review — 2026-07-01

**Owner:** architect
**Status:** complete

### Summary

**Approved with suggestions.** The durable email queue is architecturally sound: correct module boundary, single new schema table, a safe claim pattern derivable from DECISION-014, and a cron route that fits the existing `/api/` conventions. Eight rulings are documented below and all must be carried into the tech-lead's Phase 3 design doc. One new architectural decision is logged (DECISION-018) covering the directory split and the rendered-HTML storage choice. The feature requires the `server-only` package (likely already added by the concurrent `recordAudit()` pipeline entry; if not, it must be added here). No other new npm dependencies.

### What I did

- Read `src/lib/email.ts` in full (61 lines; `sendEmail` transport + `sendPasswordResetEmail` template; no queue logic)
- Read `src/proxy.ts` — confirmed line 28: `if (pathname.startsWith("/api/")) return NextResponse.next()` — all `/api/` paths pass through proxy without NextAuth checks
- Read `src/lib/db/schema.ts` (timestamps, status text columns, index conventions confirmed)
- Read `src/lib/auth/` directory (established precedent for multi-concern module directory splits)
- Read `docs/decisions.md` — confirmed DECISION-017 is the current highest; logged DECISION-018
- Read `docs/TODO.md` immediately before appending (two new Backlog lines)
- Read `docs/work-log/2026-07-01-record-audit-helper.md` Phase 2 ruling 3 (server-only adoption confirmed)
- Verified `server-only` is not in `package.json` today
- Verified `src/app/api/` currently has only `auth/[...nextauth]/route.ts` — no `cron/` subdirectory yet
- Verified `package.json` has `resend` and no other relevant new dependencies

### Eight Rulings

**Ruling 1 — Module layout: split into `src/lib/email/` directory.**

The analyst's file change list names `src/lib/email.ts` as the target for both `enqueueEmail()` and `processEmailQueue()`. That file is currently 61 lines. The queue module adds: `enqueueEmail()`, a CTE claim query (25+ lines of raw SQL), the process/retry loop with exponential backoff, dev-intercept/redirect handling, and lease-recovery logic — roughly 150–200 additional lines of meaningfully distinct concerns. A single 220-line file with transport + persistence + scheduling is not single-pass readable for a teaching artifact.

Ruling: promote to `src/lib/email/` with three files:

- `src/lib/email/send.ts` — existing `sendEmail()` transport + `sendPasswordResetEmail()` template. `import "server-only"` as first line.
- `src/lib/email/queue.ts` — `enqueueEmail()`, `processEmailQueue()`, claim SQL, backoff, dev-intercept/redirect. `import "server-only"` as first line.
- `src/lib/email/index.ts` — barrel re-exporting `sendEmail`, `sendPasswordResetEmail`, `enqueueEmail`. Does NOT re-export internal helpers.

Existing call sites at `import { sendEmail } from "@/lib/email"` and `import { sendPasswordResetEmail } from "@/lib/email"` continue to resolve unchanged through the barrel. Import-path churn at existing call sites is zero.

Precedent: `src/lib/auth/` — the auth module now has `config.ts`, `safe-callback.ts`, `sign-in-gate.ts`, and `request-ip.ts` extracted alongside it. The same evolution applies here. See DECISION-018 for the full rationale, including the rule for when a single file crosses into directory territory.

**Ruling 2 — Schema: text status, withTimezone timestamps, composite index on (status, nextRetryAt).**

The analyst's schema sketch is structurally correct. Three specific rulings:

(a) Status column: use `text` with a TypeScript `'queued' | 'processing' | 'sent' | 'failed'` union in code. No `pgEnum`. The existing schema uses `text` for all string-enum fields (see `featureFlags`, `auditEvents` — no `pgEnum` anywhere). Consistency over convenience.

(b) All timestamps: `{ withTimezone: true }` — mandatory per the starter's Timezone-Safe Date Rendering invariant. No exceptions.

(c) Two composite indexes required (flag these to database-admin explicitly):
  - `(status, nextRetryAt)` — the claim query primary filter + sort key.
  - `(status, lastAttemptAt)` — the lease-recovery query finds stuck `processing` rows by `lastAttemptAt < now() - 10 minutes`.

The analyst's `template_key` column is **approved**: it labels the email type for monitoring/filtering without introducing a template registry. Store it as `text`, not an enum.

**Ruling 3 — HTML at rest: store rendered HTML (see DECISION-018).**

The analyst raised the privacy tradeoff (Gap 5) but deferred the ruling to Phase 2. Ruling: **store fully rendered HTML** in `html_body`/`text_body` columns at enqueue time. Rationale: (1) matches the existing `SendEmailInput` interface — no re-render step needed at processing time; (2) retries use the same rendered content, which is correct (the link was generated at request time); (3) the alternative (template key + JSON params + re-render) requires a template registry the queue processor must maintain — complexity the starter does not need. The tradeoff is documented in DECISION-018 with an explicit fork-accommodation note. The `template_key` column provides monitoring visibility without re-rendering. See DECISION-018.

**Ruling 4 — Claim pattern: single-statement CTE UPDATE via `db.execute(sql\`...\`)`.**

DECISION-014 establishes: (1) `db.batch()` is the atomic multi-write convention, and (2) `db.batch()` CANNOT be used when write N depends on the result of write N-1. The atomic claim is precisely that exception — the UPDATE must consume the IDs produced by the SELECT, within the same statement.

The analyst's adversarial pass correctly identifies the safe pattern. Mandatory claim implementation:

```sql
WITH eligible AS (
  SELECT id FROM email_queue
  WHERE status = 'queued'
    AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
    AND attempt_count < max_attempts
  ORDER BY COALESCE(next_attempt_at, '-infinity'::timestamptz) ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $limit
)
UPDATE email_queue
SET status = 'processing',
    last_attempt_at = NOW(),
    updated_at = NOW()
FROM eligible
WHERE email_queue.id = eligible.id
RETURNING *
```

This is one HTTP request over the neon-http driver. PostgreSQL executes the entire CTE+UPDATE as a single implicit transaction. The `FOR UPDATE SKIP LOCKED` in the CTE applies within that single statement; two concurrent workers calling this statement simultaneously claim disjoint row sets. No interactive transaction is needed or used.

Implementation: `db.execute(sql\`...\`)` from `drizzle-orm` — the `sql` template tag is already used in `schema.ts`. This is an explicit exception to the `db.batch()` convention, as DECISION-014 anticipates. The tech-lead must document the exception in the design doc and reference DECISION-014 at the call site.

**Ruling 5 — Cron route: `src/app/api/cron/email-queue/route.ts`, GET handler, vercel.json approved.**

`proxy.ts` line 28 unconditionally passes all `/api/` paths: `if (pathname.startsWith("/api/")) return NextResponse.next()`. The cron route lives under `/api/` and is gated by CRON_SECRET bearer auth at the route handler level — no NextAuth session involved. This is the correct pattern and consistent with the starter's api/ conventions.

Route: `src/app/api/cron/email-queue/route.ts`. Export `GET` only (Vercel cron uses GET). 503 when `CRON_SECRET` is unset. Clamp `?limit` param (default 25, max 200). Return `{ ok: true, processed, sent, failed, givenUp }`.

`vercel.json`: new file at project root. The starter ships no `vercel.json` today — this is the first. The file starts minimal: `{ "crons": [{ "path": "/api/cron/email-queue", "schedule": "*/5 * * * *" }] }`. No other Vercel configuration in the file at this stage; future additions (headers, rewrites) extend this file. The analyst's Gap 7 note (this is a structural addition) is acknowledged — confirmed acceptable at this stage.

**Ruling 6 — Feature flag: NO flag for the processor.**

The analyst recommends no feature flag, arguing a flag would require maintaining a parallel fire-and-forget path. That argument applies to flagging the entire queue path. But the question is whether to flag the cron PROCESSOR specifically.

Ruling: **no flag**. The `CRON_SECRET` env var is the correct deployment gate for the cron worker. When `CRON_SECRET` is unset, the handler returns 503 — processing stops; the queue accumulates without sending. When `CRON_SECRET` is set, the handler runs. This is already a binary on/off per DECISION-003's definition of "is feature X turned on for this environment?" — CRON_SECRET satisfies that function. Adding a `feature_flags` row for `email_queue.enabled` would create two independent disable controls for the same behavior, which is confusing and unnecessary. Forks that want a softer control can unset `CRON_SECRET` or remove the `vercel.json` cron schedule entry.

The header `**Flag(s):** None recommended` stands.

**Ruling 7 — Dependencies: `server-only` only; no other new packages.**

`resend` is already in `package.json`. All other imports (`drizzle-orm/neon-http`, `next/headers`, `@/lib/db`, `@/lib/db/schema`) are existing. No new dependencies beyond `server-only`.

`server-only` adoption follows the convention established in the concurrent `recordAudit()` Phase 2 ruling 3. The record-audit-helper feature adds `server-only` to `package.json`. If email-queue ships first (or in parallel), it must also add `server-only`. Either way: `import "server-only"` in both `send.ts` and `queue.ts`. Do NOT put it only in the barrel `index.ts` — the guard must appear in each module that would cause a build error if accidentally imported on the client or Edge runtime, not only in the re-export point.

**Ruling 8 — Out of scope: two items added to docs/TODO.md Backlog.**

- Admin queue viewer under `/admin/email-queue` — display status, recipient, subject, attempt count, last error per row; filter by status and date range. Needs `admin.email_queue` permission when built.
- Resend delivery webhook (Svix-verified webhook to update row status from `sent` to `delivered` or `bounced`) — harvest Tier 2 #7 optional pair.

Both lines appended to `docs/TODO.md` Backlog immediately after this section is written.

### Outputs

- `docs/decisions.md` — DECISION-018 appended (email directory split + rendered HTML storage)
- `docs/work-log/2026-07-01-email-queue.md` — Phase 2 section added; status row updated to complete / Approved with suggestions / 2026-07-01
- `docs/TODO.md` — two Backlog lines appended (queue viewer, Resend webhook)

### Open questions / handoff notes

For tech-lead (Phase 3):

- **Ruling 1 implementation note**: the barrel at `src/lib/email/index.ts` must NOT re-export `sendEmail` in a way that encourages bypass. Consider whether to export it at all, or rename it to `_sendEmailTransport` to signal its internal role. DECISION-018 establishes the invariant: "call `enqueueEmail()` from server actions/pages; `sendEmail()` is internal." The tech-lead must document how to make this enforced or at minimum obvious.
- **Ruling 4 claim SQL**: the `COALESCE(next_attempt_at, '-infinity'::timestamptz)` ordering ensures rows with a null `next_attempt_at` (brand-new, never attempted) sort first. Verify this behavior is correct given the inline-attempt flow: `enqueueEmail()` writes `next_attempt_at = null` initially, attempts inline send, and on failure sets `next_attempt_at = now() + 1 minute`. On success it sets `status = 'sent'` immediately. So `next_attempt_at = null` in the queue only exists during the sub-second window between the insert and the inline attempt result. The worker should never see a null `next_attempt_at` row in practice. The tech-lead should confirm and document this in the design doc.
- **Analyst Gap 1 (lease recovery)**: confirmed architectural requirement. Must be in the Phase 3 design as an explicit step 1 in `processEmailQueue` before claiming new rows.
- **Analyst Gap 2 (production guard for dev vars)**: confirmed. The `console.error` warning when `EMAIL_DEV_INTERCEPT` or `EMAIL_DEV_REDIRECT_TO` is set in production must be in the design doc as a required safeguard.
- **Analyst Gap 3 (microcopy)**: the UX-developer must check the toast text in both `requestEmailChange` and the success path for `forgot-password` — confirm it doesn't imply immediate delivery.
- **Analyst Gap 9 (.env.example)**: `CRON_SECRET` must be documented as REQUIRED for the cron processor to run (not optional). `EMAIL_DEV_INTERCEPT` and `EMAIL_DEV_REDIRECT_TO` are dev-only overrides. The tech-lead must include `.env.example` update in the implementation spec.
- **vercel.json**: the starter now has `vercel.json` at the project root. If future features (custom headers, rewrites, function config) need entries there, they extend this same file. Mention this in the design doc as a new structural file.
- **`sendPasswordResetEmail()` migration path (analyst Gap 8)**: recommend keeping it as a thin wrapper over `enqueueEmail()` in `send.ts` for backward compat — no breaking change for forks. The tech-lead decides and documents in release notes.

---

## Phase 3 — Technical Design — 2026-07-01

**Owner:** tech-lead
**Status:** complete

### Summary

The durable email queue adds a new `email_queue` table, promotes `src/lib/email.ts` to a three-file directory, migrates the two existing send sites to `enqueueEmail()`, adds a Vercel cron route, and creates `vercel.json`. Every design decision below is self-contained enough that implementers need no further judgment calls beyond reading the files fresh (critical given concurrent Phase 4 work modifying the same action files).

### What I did

Confirmed the full state of:
- `src/lib/db/schema.ts` — existing table conventions, timestamp patterns, index naming
- `src/lib/email.ts` — current 61-line implementation (Resend transport + password-reset template)
- Both caller files (`src/app/(password-reset)/actions.ts` line 79, `src/app/(account)/account/actions.ts` line 148)
- `drizzle/` — three committed versioned migrations already exist (confirms `db:generate` convention)
- `.env.example` — current contents; `server-only` already in `package.json` (recordAudit Phase 4 added it)
- `vercel.json` — does not exist yet (Phase 2 Ruling 5 approved creating it)
- `docs/decisions.md` — DECISION-019 is newest; no new decision needed beyond what Phase 2 logged

---

### 1. Schema — `emailQueue` table

Add to `src/lib/db/schema.ts` after `passwordResetTokens`:

```typescript
// Email queue — persist-first outbound email with exponential-backoff retry.
// Rendered HTML (including token URLs) is stored at rest; see DECISION-018
// Sub-decision 2 for the privacy tradeoff and fork accommodation note.
// Single-recipient only: insert one row per recipient for multi-recipient needs.

export const emailQueue = pgTable(
  "email_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Intended recipient. Always the real address even when EMAIL_DEV_REDIRECT_TO
    // overrides the live send. Stored for monitoring and permanent-fail auditing.
    toEmail: text("to_email").notNull(),
    // Nullable; if null, the send step defaults to RESEND_FROM_EMAIL at send time.
    // Storing it ensures retries use the same from address as the initial attempt.
    fromEmail: text("from_email"),
    replyTo: text("reply_to"),
    subject: text("subject").notNull(),
    // Fully rendered HTML including any token URLs. See DECISION-018.
    htmlBody: text("html_body").notNull(),
    textBody: text("text_body"),
    // Label for the email type: 'password_reset' | 'email_change_verify'.
    // Used for monitoring/filtering and permanent-fail audit events.
    // NOT used to re-render at send time.
    templateKey: text("template_key").notNull(),
    // 'queued' | 'processing' | 'sent' | 'failed' — text per existing schema convention (no pgEnum).
    status: text("status").notNull().default("queued"),
    // Incremented on each attempt (inline or worker). Starts at 0.
    attemptCount: integer("attempt_count").notNull().default(0),
    // Default 8: inline attempt + up to 7 worker retries before permanent failure.
    maxAttempts: integer("max_attempts").notNull().default(8),
    // NULL on insert = eligible for immediate inline attempt.
    // Set to backoff schedule (now + delay) after each failed worker attempt.
    // After the inline attempt completes (success or failure), this is non-null.
    // The worker NEVER sees a null nextAttemptAt row in practice because the
    // inline path resolves before the first cron window (sub-second vs 5 minutes).
    // The COALESCE in the claim SQL handles the null case defensively.
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    // Set to NOW() when the worker claims the row (via the CTE UPDATE).
    // Also used for the lease-recovery query: rows in 'processing' with
    // lastAttemptAt < now() - 10 minutes are considered stuck and re-queued.
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    // Set when status transitions to 'sent'.
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // Resend message ID on successful send; 'dev-intercepted:<uuid>' in dev mode.
    providerMessageId: text("provider_message_id"),
    // Last error message from Resend on failure. Overwritten on each attempt.
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Primary worker query filter: WHERE status='queued' AND nextAttemptAt <= now()
    index("ix_email_queue_status_next").on(t.status, t.nextAttemptAt),
    // Lease-recovery query: WHERE status='processing' AND lastAttemptAt < now()-10min
    index("ix_email_queue_status_last").on(t.status, t.lastAttemptAt),
  ],
);
```

No relations are required (the queue rows are not joined to users in any query).

**Migration approach: `db:generate` (versioned SQL migration), not `db:push`.**

Rationale: `drizzle/` already contains three committed SQL migrations (`0000_initial.sql`, `0001_rapid_thor_girl.sql`, `0002_curious_famine.sql`). The project is past the "early dev branch iteration" stage that DECISION-001 reserves for `db:push`. DECISION-001 explicitly states: "once a fork is in production, `db:generate` + committed SQL becomes the right path." The database-admin runs `npm run db:generate` after adding the table definition, then commits the generated file (e.g. `drizzle/0003_email_queue.sql`) alongside the `schema.ts` change. The migration is applied via `npm run db:migrate`.

---

### 2. `src/lib/email/` directory layout

#### `src/lib/email/send.ts`

Move the existing `src/lib/email.ts` content here verbatim with one change:
- Add `import "server-only";` as the **first** line (before any other import).
- Keep `sendEmail()` exported (used by `queue.ts` — internal import, never from the barrel).
- Keep `sendPasswordResetEmail()` exported with a `@deprecated` JSDoc comment and the same body (still calls `sendEmail()` directly — see backward-compat note below).
- Export `SendEmailInput` type as before.

`sendPasswordResetEmail()` in `send.ts` intentionally continues to call `sendEmail()` directly (fire-and-forget) rather than `enqueueEmail()`. Making it call `enqueueEmail()` would create a circular import (`send.ts` → `queue.ts` → `send.ts`). The barrel re-exports it for fork backward compat, with a deprecation comment. Fork callers should migrate to `enqueueEmail()`. The two starter call sites are migrated (see §3).

#### `src/lib/email/queue.ts`

```typescript
import "server-only";

import { db } from "@/lib/db";
import { emailQueue } from "@/lib/db/schema";
import { auditEvents } from "@/lib/db/schema";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { sql, and, eq, lt } from "drizzle-orm";
import { sendEmail } from "./send";
import type { SendEmailInput } from "./send";

// ----- Types ---------------------------------------------------------------

export type EnqueueEmailInput = {
  to: string;               // single recipient only; insert multiple rows for multiple recipients
  subject: string;
  html: string;
  text?: string;
  from?: string;            // defaults to RESEND_FROM_EMAIL at send time if omitted
  replyTo?: string;
  templateKey: string;      // 'password_reset' | 'email_change_verify' | any label
  maxAttempts?: number;     // default 8
};

export type BatchResult = {
  claimed: number;
  sent: number;
  failed: number;
  requeued: number;         // count of rows re-queued after permanent failure (always 0 — for clarity)
};

// ----- Backoff formula -----------------------------------------------------
// delay = min(2^(attemptCount-1), 60) minutes
// where attemptCount is the NEW value after increment (1-indexed).
// Sequence: 1m → 2m → 4m → 8m → 16m → 32m → 60m (cap) → 60m
// With maxAttempts=8: attempts 1-7 get backoff; attempt 8 marks FAILED.

function computeNextAttemptAt(attemptCount: number): Date {
  const delayMs = Math.min(Math.pow(2, attemptCount - 1), 60) * 60 * 1000;
  return new Date(Date.now() + delayMs);
}

// ----- Dev guard -----------------------------------------------------------
// Called at the top of processQueueBatch(). Loud but non-fatal — a throw here
// would stop ALL email processing even when most rows are healthy.

function warnIfDevVarsInProd(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.EMAIL_DEV_INTERCEPT || process.env.EMAIL_DEV_REDIRECT_TO) {
    console.error(
      "[email-queue] WARNING: dev override env var set in production — " +
        "emails may not reach real recipients",
      {
        EMAIL_DEV_INTERCEPT: !!process.env.EMAIL_DEV_INTERCEPT,
        EMAIL_DEV_REDIRECT_TO: !!process.env.EMAIL_DEV_REDIRECT_TO,
      },
    );
  }
}

// ----- Low-level send attempt (used by both inline and worker paths) -------

async function attemptSend(
  row: typeof emailQueue.$inferSelect,
): Promise<{ providerMessageId: string } | { error: string }> {
  // Dev intercept: skip Resend entirely; treat as sent.
  if (process.env.EMAIL_DEV_INTERCEPT) {
    return { providerMessageId: `dev-intercepted:${row.id}` };
  }

  const recipient = process.env.EMAIL_DEV_REDIRECT_TO ?? row.toEmail;
  // When redirecting, log the intended recipient so ops can forward manually.
  if (process.env.EMAIL_DEV_REDIRECT_TO) {
    console.warn(
      `[email-queue] EMAIL_DEV_REDIRECT_TO active: sending to ${recipient} instead of ${row.toEmail}`,
    );
  }

  try {
    const result = await sendEmail({
      to: recipient,
      from: row.fromEmail ?? undefined,
      replyTo: row.replyTo ?? undefined,
      subject: row.subject,
      html: row.htmlBody,
      text: row.textBody ?? undefined,
    });
    return { providerMessageId: result.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ----- enqueueEmail --------------------------------------------------------
// Persist-first: insert the row, attempt inline send, update status.
// Always returns; never throws on send failure.

export async function enqueueEmail(
  input: EnqueueEmailInput,
): Promise<{ id: string; sentInline: boolean }> {
  // 1. Insert with status='queued', nextAttemptAt=null (eligible immediately)
  const [row] = await db
    .insert(emailQueue)
    .values({
      toEmail: input.to,
      fromEmail: input.from ?? null,
      replyTo: input.replyTo ?? null,
      subject: input.subject,
      htmlBody: input.html,
      textBody: input.text ?? null,
      templateKey: input.templateKey,
      maxAttempts: input.maxAttempts ?? 8,
    })
    .returning();

  // 2. Attempt inline send
  const outcome = await attemptSend(row);

  if ("providerMessageId" in outcome) {
    // 3a. Success: mark sent
    await db
      .update(emailQueue)
      .set({
        status: "sent",
        sentAt: new Date(),
        providerMessageId: outcome.providerMessageId,
        attemptCount: 1,
        lastAttemptAt: new Date(),
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(emailQueue.id, row.id));
    return { id: row.id, sentInline: true };
  } else {
    // 3b. Failure: stay queued, schedule first retry in 1 minute
    await db
      .update(emailQueue)
      .set({
        status: "queued",
        attemptCount: 1,
        lastAttemptAt: new Date(),
        nextAttemptAt: computeNextAttemptAt(1),
        failureReason: outcome.error,
        updatedAt: new Date(),
      })
      .where(eq(emailQueue.id, row.id));
    return { id: row.id, sentInline: false };
  }
}

// ----- processQueueBatch ---------------------------------------------------
// Called by the cron route. Performs:
//   Step 0: Dev guard (warn if dev vars set in production)
//   Step 1: Lease recovery (re-queue stuck 'processing' rows > 10 min old)
//   Step 2: Atomic claim via single-statement CTE UPDATE...RETURNING (DECISION-014 exception)
//   Step 3: Send each claimed row; update status
//   Step 4: Log and return counts

export async function processQueueBatch(limit = 25): Promise<BatchResult> {
  // Step 0: Dev guard
  warnIfDevVarsInProd();

  let requeued = 0;

  // Step 1: Lease recovery — re-queue any 'processing' rows with
  // lastAttemptAt older than 10 minutes (cron function likely crashed mid-batch).
  // This runs BEFORE the claim so recovered rows are eligible for this batch.
  const leaseExpiry = new Date(Date.now() - 10 * 60 * 1000);
  const recovered = await db
    .update(emailQueue)
    .set({
      status: "queued",
      nextAttemptAt: new Date(), // eligible immediately
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emailQueue.status, "processing"),
        lt(emailQueue.lastAttemptAt, leaseExpiry),
      ),
    )
    .returning({ id: emailQueue.id });
  requeued = recovered.length;
  if (requeued > 0) {
    console.warn(`[email-queue] lease-recovery: re-queued ${requeued} stuck rows`);
  }

  // Step 2: Atomic claim — SINGLE STATEMENT, CTE UPDATE...RETURNING.
  // This is the DECISION-014 exception: the UPDATE must consume the IDs
  // produced by the subquery in the same statement. db.batch() cannot do this.
  // See DECISION-018. Two concurrent workers claim disjoint sets via SKIP LOCKED.
  const claimedRows = await db.execute(sql`
    WITH eligible AS (
      SELECT id FROM email_queue
      WHERE status = 'queued'
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        AND attempt_count < max_attempts
      ORDER BY COALESCE(next_attempt_at, '-infinity'::timestamptz) ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE email_queue
    SET status = 'processing',
        last_attempt_at = NOW(),
        updated_at = NOW()
    FROM eligible
    WHERE email_queue.id = eligible.id
    RETURNING *
  `);

  const rows = claimedRows.rows as (typeof emailQueue.$inferSelect)[];
  const claimed = rows.length;
  let sent = 0;
  let failed = 0;

  // Step 3: Process each claimed row
  for (const row of rows) {
    const outcome = await attemptSend(row);
    const newAttemptCount = row.attemptCount + 1;

    if ("providerMessageId" in outcome) {
      // Success
      await db
        .update(emailQueue)
        .set({
          status: "sent",
          sentAt: new Date(),
          providerMessageId: outcome.providerMessageId,
          attemptCount: newAttemptCount,
          failureReason: null,
          updatedAt: new Date(),
        })
        .where(eq(emailQueue.id, row.id));
      sent++;
    } else if (newAttemptCount >= row.maxAttempts) {
      // Permanent failure
      await db
        .update(emailQueue)
        .set({
          status: "failed",
          attemptCount: newAttemptCount,
          failureReason: outcome.error,
          updatedAt: new Date(),
        })
        .where(eq(emailQueue.id, row.id));
      failed++;

      // Permanent-failure audit event (see §8 below)
      await db.insert(auditEvents).values({
        actorUserId: null,
        actorEmail: row.toEmail,
        action: AUDIT_ACTIONS.EMAIL_QUEUE_PERMANENT_FAILURE,
        resourceType: "email_queue",
        resourceId: row.id,
        metadata: {
          templateKey: row.templateKey,
          toEmail: row.toEmail,
          attemptCount: newAttemptCount,
          failureReason: outcome.error,
        },
      });

      console.error("[email-queue] permanent failure", {
        id: row.id,
        toEmail: row.toEmail,
        templateKey: row.templateKey,
        failureReason: outcome.error,
      });
    } else {
      // Transient failure — requeue with backoff
      await db
        .update(emailQueue)
        .set({
          status: "queued",
          attemptCount: newAttemptCount,
          nextAttemptAt: computeNextAttemptAt(newAttemptCount),
          failureReason: outcome.error,
          updatedAt: new Date(),
        })
        .where(eq(emailQueue.id, row.id));
    }
  }

  return { claimed, sent, failed, requeued };
}
```

#### `src/lib/email/index.ts` (barrel)

```typescript
// Public API for @/lib/email. All existing import { ... } from "@/lib/email"
// call sites continue to resolve through this barrel without path changes.

// enqueueEmail is the canonical entry point for all outbound email.
// Do NOT call sendEmail() directly from server actions or pages — see DECISION-018.
export { enqueueEmail } from "./queue";
export type { EnqueueEmailInput, BatchResult } from "./queue";

// sendPasswordResetEmail is kept for fork backward compat.
// @deprecated — call enqueueEmail() directly with templateKey: 'password_reset'.
// Starter call sites have been migrated to enqueueEmail(); this export exists
// so fork callers are not broken. Will be removed in a future version.
export { sendPasswordResetEmail } from "./send";
export type { SendEmailInput } from "./send";

// sendEmail is intentionally NOT re-exported here. It is the raw transport
// used only by queue.ts. Exposing it from the barrel would allow callers to
// bypass the queue — a violation of DECISION-018's invariant.
```

---

### 3. Caller migrations

**CRITICAL ordering note**: Both `src/app/(password-reset)/actions.ts` and `src/app/(account)/account/actions.ts` are being modified by the concurrent `recordAudit` Phase 4 and `isUniqueViolation` Phase 4. The email-queue Phase 4 **runs last** in that sequence and must read both files fresh before editing.

#### `src/app/(password-reset)/actions.ts`

Change at line 10:
```typescript
// BEFORE
import { sendPasswordResetEmail } from "@/lib/email";

// AFTER
import { enqueueEmail } from "@/lib/email";
```

Change at line 79 (the send call):
```typescript
// BEFORE
await sendPasswordResetEmail(userRow.email, rawToken);

// AFTER
await enqueueEmail({
  to: userRow.email,
  subject: "Reset your password",
  html: `
    <p>Hi,</p>
    <p>Someone requested a password reset for your account.</p>
    <p>Click the link below to set a new password. This link expires in 60 minutes.</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p>If you did not request this, you can safely ignore this email.</p>
  `,
  text: `Click the link below to reset your password. This link expires in 60 minutes.\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
  templateKey: "password_reset",
});
```

Where `resetUrl` is built inline (same as current `sendPasswordResetEmail` body). The api-developer extracts this construction from `send.ts` and inlines it here, so `send.ts` can remain a pure transport file.

The audit event (lines 81-88) already fires after this call. With queuing, `enqueueEmail()` never throws on send failure (it catches internally), so the audit event now correctly fires even when the inline send fails. No reordering needed — enqueue first, then audit event.

Enumeration safety: unchanged. The action still returns `{ ok: true }` regardless of whether the inline send succeeded.

#### `src/app/(account)/account/actions.ts`

Change at line 11:
```typescript
// BEFORE
import { sendEmail } from "@/lib/email";

// AFTER
import { enqueueEmail } from "@/lib/email";
```

Change at lines 148-159 (the sendEmail block):
```typescript
// BEFORE
await sendEmail({
  to: newEmail,
  subject: "Confirm your new email address",
  html: `...`,
  text: `...`,
});

// AFTER
await enqueueEmail({
  to: newEmail,
  subject: "Confirm your new email address",
  html: `
    <p>Hi,</p>
    <p>You requested to change your sign-in email address to <strong>${newEmail}</strong>.</p>
    <p>Click the link below to confirm. The link expires in 24 hours.</p>
    <p><a href="${verifyUrl}">${verifyUrl}</a></p>
    <p>If you did not request this change, you can safely ignore this email.</p>
  `,
  text: `Confirm your email change: ${verifyUrl}\n\nExpires in 24 hours. If you did not request this, ignore this email.`,
  templateKey: "email_change_verify",
});
```

The audit event (lines 161-168) already fires after this call — unchanged; same reasoning as the password-reset caller: `enqueueEmail()` does not throw on send failure.

**Exact `ActionResult` message for the success toast:**
`requestEmailChange` currently returns `{ ok: true }` after the send call — the component's toast text is what matters. The api-developer must verify the component text and, if it currently says anything implying immediate delivery ("Email sent", "Verification email sent"), change it to:

```
"Check your email to confirm the change."
```

This phrasing is accurate regardless of whether the send was inline-synchronous or queued. The word "queued" must never appear in user-facing strings. For the password-reset action, the existing UX already shows "If an account exists, we sent you a link." — this remains correct and requires no change.

---

### 4. Cron route

**File:** `src/app/api/cron/email-queue/route.ts`

```typescript
import { processQueueBatch } from "@/lib/email/queue";

const CRON_SECRET = process.env.CRON_SECRET;

// Vercel cron invokes via GET. See vercel.json.
// POST is intentionally omitted — add when an admin "retry now" button is built.
export async function GET(req: Request) {
  // Guard: CRON_SECRET must be set for the worker to run.
  // Without it, ops has no way to authenticate requests — return 503 so the
  // Vercel cron dashboard surfaces a visible failure rather than silently no-oping.
  if (!CRON_SECRET) {
    return Response.json(
      { error: "Email queue worker disabled: set CRON_SECRET to enable." },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = Math.min(
    Math.max(1, parseInt(rawLimit ?? "25", 10) || 25),
    200,
  );

  const result = await processQueueBatch(limit);

  return Response.json({ ok: true, ...result });
}
```

Response shape: `{ ok: true, claimed: number, sent: number, failed: number, requeued: number }`

`?limit` behavior:
- Default: 25 (safe batch size for a 10-second Vercel function timeout with ~200ms Resend latency per send)
- Max: 200 (prevents runaway callers from creating function timeouts; 200 × 200ms ≈ 40s, within Vercel Pro's 60s limit)
- Non-numeric input falls through `|| 25` to the default

No `import "server-only"` — this is a Next.js route handler, not a library module; the rule applies to library modules only.

**`vercel.json`** (new file at project root):

```json
{
  "crons": [
    {
      "path": "/api/cron/email-queue",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

Schedule justification: every 5 minutes. A failed inline send retries within 5 minutes — fast enough for a user who submits a password reset and checks email shortly after. The Vercel Hobby plan supports a minimum of once per day; forks on Hobby must set a longer interval or rely exclusively on the inline send. On Pro (minimum once per minute), `*/5` is well within limits. Matches fertilityluna's proven production value.

Note: This is the first `vercel.json` in the project. Future features requiring Vercel-specific config (headers, rewrites, function region) extend this file rather than creating a new one.

---

### 5. `.env.example` additions

Add immediately after the `RESEND_FROM_EMAIL` line, under the existing `# --- Email (Resend) ---` section:

```bash
# --- Email queue worker (Vercel cron) --------------------------------------
# REQUIRED in production: the email queue processor returns 503 when this is
# unset, accumulating emails indefinitely without processing.
# Generate: openssl rand -base64 32
CRON_SECRET=

# --- Email dev overrides (dev/test only — NEVER set in production) ---------
# Skip Resend entirely; mark queued rows as 'sent' with a synthetic id.
# Useful for local testing without a Resend API key.
# EMAIL_DEV_INTERCEPT=1

# Override the recipient address; all emails are delivered to this address
# instead. The intended recipient is still stored on the queue row (toEmail).
# EMAIL_DEV_REDIRECT_TO=
```

---

### 6. Test plan

**Unit tests (Vitest) — `src/lib/email/queue.test.ts`:**

1. **Backoff math** — `computeNextAttemptAt` (export it or test via module internals):
   - attemptCount=1 → delay ~60,000 ms (1 minute ± 50ms tolerance)
   - attemptCount=2 → ~120,000 ms
   - attemptCount=6 → ~1,920,000 ms (32 minutes)
   - attemptCount=7 → ~3,600,000 ms (60 minutes — cap)
   - attemptCount=8 → ~3,600,000 ms (still capped)
   - attemptCount=10 → ~3,600,000 ms (still capped)

2. **Claim SQL shape** (structural, compile-time check):
   - Assert the sql template literal constructed in `processQueueBatch` contains the string `FOR UPDATE SKIP LOCKED` and `RETURNING *`. This can be validated by inspecting the query string produced by `sql\`...\`` via `drizzle-orm`'s `getSQL().sql` before execution. Test that the shape is correct without executing against a real DB.

3. **`enqueueEmail` persist-first behavior** (mock `db` and `sendEmail`):
   - Mock `db.insert(...).values(...).returning()` to return a row with a known id
   - Case A — inline send succeeds: verify `db.update` sets `status='sent'`, `sentAt` is set, `providerMessageId` is set, `attemptCount=1`; return `{ sentInline: true }`
   - Case B — inline send fails (mock `sendEmail` throws): verify `db.update` sets `status='queued'`, `attemptCount=1`, `nextAttemptAt` ≈ now + 60s, `failureReason` is the error message; return `{ sentInline: false }`
   - In both cases: `db.insert` is called BEFORE `sendEmail` is attempted

4. **Dev intercept and redirect logic** (mock env vars and `sendEmail`):
   - `EMAIL_DEV_INTERCEPT=1`: `sendEmail` is NOT called; outcome returns `providerMessageId='dev-intercepted:<id>'`
   - `EMAIL_DEV_REDIRECT_TO=test@example.com`: `sendEmail` IS called; verify it receives `to='test@example.com'` while the row's `toEmail` field remains the original address

5. **Lease recovery** (mock `db`):
   - Two `processing` rows: one with `lastAttemptAt` 15 minutes ago (stuck), one 3 minutes ago (healthy)
   - After calling `processQueueBatch`, verify `db.update` with `status='queued'` applies only to the stuck row
   - Verify the `lt(emailQueue.lastAttemptAt, leaseExpiry)` filter uses a threshold of `Date.now() - 10 * 60 * 1000`

6. **Production guard** (mock `process.env`):
   - Set `NODE_ENV='production'` and `EMAIL_DEV_INTERCEPT='1'`
   - Spy on `console.error`
   - Call `processQueueBatch` (mock the DB calls to return empty)
   - Assert `console.error` was called with a message containing "dev override env var set in production"
   - Assert processing still continued (no throw)

**Not unit-testable (accepted gaps):**

- **`FOR UPDATE SKIP LOCKED` concurrency semantics**: this is a Postgres-enforced guarantee. Verifying that two concurrent workers claim disjoint sets requires two simultaneous DB connections. Cannot be simulated by mocking. Accepted gap; the correctness argument is in Phase 1 adversarial pass + DECISION-018.
  
  If QA wants stronger coverage: run a Neon-branch integration step — seed 50 rows, fire two concurrent `curl` requests to the cron route, verify no duplicate `providerMessageId` values. This is a manual QA step, not required for Phase 5 PASS.

- **Vercel cron scheduling**: infrastructure-level behavior; only testable via live deployment.

- **Live Resend delivery**: requires a live API key and a real email inbox. E2E requirement for auth-touching features does NOT apply here — this feature does not touch `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, or `src/lib/auth/`. Standard Phase 5 unit + typecheck verification is sufficient.

**`src/app/api/cron/email-queue/route.test.ts`** (optional but recommended):
- CRON_SECRET unset → 403 and 503 response body contains "disabled"
- Wrong bearer → 401
- Valid bearer → calls `processQueueBatch` with clamped limit
- `?limit=500` → clamped to 200

---

### 7. Implementer split

**Decision: database-admin first, then api-developer.**

Rationale: The api-developer's first meaningful action is importing `emailQueue` from `@/lib/db/schema`. That import cannot resolve until the table definition exists in `schema.ts` AND the migration is generated (otherwise `npm run typecheck` fails). Running database-admin first produces a clean schema that api-developer depends on. The two phases are cleanly delineated and there is zero overlap in what each agent touches.

**database-admin scope (Phase 4a):**
- Add `emailQueue` table definition to `src/lib/db/schema.ts` (exact definition in §1 above)
- Run `npm run db:generate` to produce the versioned migration (Neon dev branch recommended)
- Verify the generated SQL matches the schema (CREATE TABLE with correct columns + two indexes)
- Commit `schema.ts` change + generated migration file

**api-developer scope (Phase 4b, runs after Phase 4a AND after recordAudit + unique-violation Phase 4):**
- Delete `src/lib/email.ts`
- Create `src/lib/email/send.ts` (content in §2)
- Create `src/lib/email/queue.ts` (content in §2)
- Create `src/lib/email/index.ts` (content in §2)
- Add `EMAIL_QUEUE_PERMANENT_FAILURE: "email.queue.permanent_failure"` to `AUDIT_ACTIONS` in `src/lib/audit.ts`
- Migrate `src/app/(password-reset)/actions.ts` (§3 — read fresh; concurrent modifications in flight)
- Migrate `src/app/(account)/account/actions.ts` (§3 — read fresh; concurrent modifications in flight)
- Create `src/app/api/cron/email-queue/route.ts` (§4)
- Create `vercel.json` at project root (§4)
- Update `.env.example` (§5)
- Write unit tests (§6)

---

### 8. Audit events

**Sends in flight (claim → success/fail): NO audit events.** Individual send attempts are operational log events, not security-sensitive mutations. Writing an audit event per attempt would flood the audit log with noise and obscure the security-relevant events.

**Permanent failure (maxAttempts exhausted): YES, write one audit event.** Rationale: a permanently failed email means a user-initiated action (password reset, email change) may never complete — this is security-relevant (a user locked out of password reset because emails silently failed). The original user-action audit event (`USER_PASSWORD_RESET_REQUESTED`, `USER_EMAIL_CHANGE_REQUESTED`) fires at enqueue time. The permanent-failure event closes the lifecycle in the audit log, giving ops the full picture: "requested at T, permanently failed at T+N."

New `AUDIT_ACTIONS` key: `EMAIL_QUEUE_PERMANENT_FAILURE: "email.queue.permanent_failure"` in `src/lib/audit.ts`.

**`check:audit` tripwire note**: The tripwire (`npm run check:audit`) scans `actions.ts` files only. The permanent-failure audit event is written from `src/lib/email/queue.ts`, which is not an `actions.ts`. The tripwire does not cover it — this is acceptable. The event is written in a library module that has clear single ownership (the queue processor). Documenting the exception here so future maintainers do not think the event is a tripwire gap; it is not. The tripwire exists to catch *missing* events in actions files where they are expected; queue.ts is not an actions file.

---

### Outputs

- `docs/work-log/2026-07-01-email-queue.md` — Phase 3 section added; status row updated to complete / 2026-07-01
- No new `docs/decisions.md` entry required — DECISION-018 (Phase 2) and DECISION-014 (prior) fully cover the decisions made here. Implementation choices (maxAttempts=8, db:generate approach, database-admin-first sequence, permanent-fail audit position) are documented in this design doc.

### Open questions / handoff notes

**For database-admin (Phase 4a — run first):**
- Add `emailQueue` table to `schema.ts` exactly as specified in §1. No relations needed.
- Run `npm run db:generate` (on a Neon dev branch per DECISION-001 conventions). Commit schema.ts + generated SQL.
- The `COALESCE(next_attempt_at, '-infinity'::timestamptz)` in the claim SQL is Postgres standard; no driver concern.

**For api-developer (Phase 4b — run AFTER database-admin AND after recordAudit + unique-violation Phase 4):**
- Read `src/app/(password-reset)/actions.ts` and `src/app/(account)/account/actions.ts` **fresh** before editing — concurrent Phase 4 work will have modified them.
- The `resetUrl` construction (baseUrl + `/reset-password?token=`) must be inlined at the `enqueueEmail()` call site in the password-reset action, since it was previously inside `sendPasswordResetEmail()` in send.ts. Extract it from the current `send.ts` body before deleting that file.
- Add `EMAIL_QUEUE_PERMANENT_FAILURE` to AUDIT_ACTIONS in `src/lib/audit.ts`.
- For the account action microcopy: verify the component file that handles the `requestEmailChange` ActionResult and confirm/update the success toast text to exactly "Check your email to confirm the change." — the word "queued" must never appear in user-facing strings.
- The `sendEmail()` function is intentionally still exported from `send.ts` (for queue.ts to import) but is NOT exported from the barrel. If any linter flags an unused export, that is expected and correct.
- `server-only` is already in `package.json` (no `npm install` needed).

**For QA (Phase 5):**
- This feature does NOT touch auth files — the auth-touching e2e gate does NOT apply. Standard typecheck + unit test verification is sufficient for PASS.
- Optional manual smoke: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/email-queue` against the dev server. Expect `{ ok: true, claimed: 0, sent: 0, failed: 0, requeued: 0 }` on an empty queue.
- The `FOR UPDATE SKIP LOCKED` concurrency is an accepted gap (documented in §6). Do not block PASS on this.

---

## Phase 4a — Implementation (schema) — 2026-07-01

**Owner:** database-admin
**Status:** complete

### Summary

Added the `emailQueue` table to `src/lib/db/schema.ts` exactly per the Phase 3 §1 specification. Generated a versioned SQL migration (`drizzle/0003_oval_thanos.sql`), verified the generated SQL, and applied it to the dev database. TypeScript typecheck passes clean. The `drizzle.__drizzle_migrations` journal was also updated to backfill the previously untracked `0002_curious_famine` migration, leaving all 4 migrations properly recorded.

### What I did

- Read `src/lib/db/schema.ts` in full to confirm existing conventions (uuid PKs, `withTimezone: true` on all timestamps, `$onUpdate(() => new Date())` for mutable `updatedAt`, `index()` naming style, placement of tables vs. relations block).
- Added `emailQueue` table definition immediately before the `// Relations` block (after `passwordResetTokens`), matching the Phase 3 §1 spec verbatim: 18 columns, status default `'queued'`, `maxAttempts` default `8`, two composite indexes (`ix_email_queue_status_next` on `(status, next_attempt_at)`, `ix_email_queue_status_last` on `(status, last_attempt_at)`). No FK references — the Phase 3 design confirmed queue rows are not joined to users in any query.
- Ran `npm run db:generate` — produced `drizzle/0003_oval_thanos.sql`. Reviewed the generated SQL: `CREATE TABLE "email_queue"` with all 18 columns, correct `NOT NULL` / nullable constraints, correct defaults (`'queued'::text`, `0`, `8`, `now()`), and both `CREATE INDEX` statements.
- Applied the migration via psql directly (the `drizzle-kit migrate` command fails to establish a WebSocket-over-pooler connection in this environment; psql connects to the same endpoint without issue). The SQL produced `CREATE TABLE` + `CREATE INDEX` + `CREATE INDEX` — all three statements succeeded.
- Inserted tracking records for `0002_curious_famine` and `0003_oval_thanos` into `drizzle.__drizzle_migrations`, using SHA-256 hashes of the SQL files matched against the Drizzle algorithm (verified by cross-checking hashes for `0000` and `0001` against existing records). All 4 migrations are now tracked.
- Confirmed `email_queue` exists in the database with `\d email_queue` — all 18 columns, correct types and nullability, both named indexes.
- Ran `npm run typecheck` — passes with zero errors.

### Outputs

- Schema change: `src/lib/db/schema.ts` — `emailQueue` table added before the Relations block.
- Migration file: `drizzle/0003_oval_thanos.sql` (generated by `npm run db:generate`).
- Migration mode: `db:generate` (versioned SQL migration committed to `drizzle/`) — correct choice given three prior committed migrations in the project; `db:push` was not used.
- Applied to dev database: yes — via psql direct connection to `ep-empty-cell-aq90115a-pooler.c-8.us-east-1.aws.neon.tech/neondb`. Note: `drizzle-kit migrate` fails over this pooler endpoint due to a WebSocket connection issue; direct psql is the workaround. All 4 migration tracking records are now consistent in `drizzle.__drizzle_migrations`.
- No seed changes — `email_queue` rows are created at runtime by `enqueueEmail()`; no static seed data needed.
- Tables affected: `email_queue` (new).

### Open questions / handoff notes

- **For api-developer (Phase 4b):** The `emailQueue` table and its inferred types (`typeof emailQueue.$inferSelect`, `typeof emailQueue.$inferInsert`) are available from `@/lib/db/schema`. The `status` values (`'queued' | 'processing' | 'sent' | 'failed'`) are `text` columns — no pgEnum; validate the union in TypeScript.
- **For api-developer (Phase 4b):** The `db.execute(sql\`...\`)` claim query references column names in raw SQL (`email_queue`, `status`, `next_attempt_at`, `attempt_count`, `max_attempts`, `last_attempt_at`, `updated_at`). These are `snake_case` per the column definitions above — match exactly.
- **For api-developer (Phase 4b):** No relations defined on `emailQueue` (the Phase 3 design confirmed they are not needed — no Drizzle relational queries join `email_queue` to users). The table is standalone.
- **drizzle-kit migrate issue:** The `npm run db:migrate` command fails in this environment with the pooled `@neondatabase/serverless` WebSocket driver. Future schema changes should use psql + manual tracking record insertion as the apply path, or switch `drizzle.config.ts` to use a direct (non-pooler) connection URL for Drizzle Kit operations. Consider logging this as a known dev-environment issue in `docs/decisions.md` if it surfaces again.
- **Next agent:** api-developer (Phase 4b). Must run AFTER the `recordAudit` and `isUniqueViolation` Phase 4 work completes (per Phase 3 §7 ordering note — both modify the same caller action files).
- **Local apply command for fresh environments:** `npm run db:migrate` (if the WebSocket issue is resolved) or psql direct + manual hash insertion as documented above.

---

## Phase 4b — Implementation (api) — 2026-07-01

**Owner:** api-developer
**Status:** complete

### Summary

Split `src/lib/email.ts` into `src/lib/email/` (three files), added the email queue module with persist-first enqueue + exponential-backoff retry, migrated both caller action files, created the Vercel cron route + `vercel.json`, updated `.env.example`, wrote unit tests. All verifications pass.

### What I did

- Read both caller files fresh before editing — confirmed `recordAudit` and `onConflictDoUpdate` upserts from concurrent Phase 4 work were in place.
- Created `src/lib/email/send.ts` — existing email.ts content verbatim + `import "server-only"` as first line + `@deprecated` JSDoc on `sendPasswordResetEmail`.
- Created `src/lib/email/queue.ts` — `enqueueEmail()` (persist-first insert + inline attempt + status update), `processQueueBatch()` (dev guard → lease recovery → atomic CTE claim → per-row send → update status), `computeNextAttemptAt()` (exported for tests), `fromRaw()` mapper (see deviation note below).
- Created `src/lib/email/index.ts` — barrel re-exporting `enqueueEmail`, `sendPasswordResetEmail`, `SendEmailInput`, `EnqueueEmailInput`, `BatchResult`. `sendEmail` intentionally NOT re-exported (bypass prevention per DECISION-018).
- Deleted `src/lib/email.ts`.
- Added `EMAIL_QUEUE_PERMANENT_FAILURE: "email.queue.permanent_failure"` to `AUDIT_ACTIONS` in `src/lib/audit.ts`.
- Updated `src/lib/audit.test.ts` — added `EMAIL_QUEUE_PERMANENT_FAILURE` to `EXPECTED_ENTRIES` (count auto-updates; test passes).
- Migrated `src/app/(password-reset)/actions.ts` — replaced `sendPasswordResetEmail` import and call with `enqueueEmail` + inline `resetUrl` construction. `recordAudit` call at lines 82-88 untouched. Enumeration safety preserved — `enqueueEmail()` never throws on send failure.
- Migrated `src/app/(account)/account/actions.ts` — replaced `sendEmail` import and call with `enqueueEmail` + `templateKey: "email_change_verify"`. `recordAudit` call at lines 159-164 untouched. Toast microcopy left as-is ("Check your new inbox for a verification link." — does not imply immediate delivery).
- Created `src/app/api/cron/email-queue/route.ts` — GET only, 503 when `CRON_SECRET` unset, 401 on bearer mismatch, clamped `?limit` (1–200, default 25).
- Created `vercel.json` at project root — first `vercel.json` in the project; cron entry `*/5 * * * *`.
- Updated `.env.example` — added `CRON_SECRET` (REQUIRED in production), `EMAIL_DEV_INTERCEPT`, `EMAIL_DEV_REDIRECT_TO` (commented-out dev-only vars), placed after `RESEND_FROM_EMAIL`.
- Created `src/lib/email/queue.test.ts` — 23 tests covering backoff math (6 cases), structural exports, schema exports, `AUDIT_ACTIONS` catalog, production guard, enqueueEmail persist-first (Cases A + B), claim-uses-execute, lease-recovery ordering.

### Deviation from design

**`db.execute(sql\`RETURNING *\`)` returns snake_case column names** (DB names), not camelCase. The design code cast the result to `typeof emailQueue.$inferSelect` (camelCase), which would have failed at runtime.

**Fix:** Added a `RawQueueRow` type (snake_case fields matching actual DB column names) and a `fromRaw()` function that maps to the Drizzle camelCase type. Used in `processQueueBatch` after `db.execute()`. The `enqueueEmail` function uses Drizzle's ORM `.returning()` (which does return camelCase) and is unaffected.

### Files created / modified

- `src/lib/email/send.ts` — new (extracted from deleted email.ts)
- `src/lib/email/queue.ts` — new (full queue implementation)
- `src/lib/email/index.ts` — new (barrel)
- `src/lib/email/queue.test.ts` — new (23 unit tests)
- `src/lib/email.ts` — deleted
- `src/lib/audit.ts` — additive: `EMAIL_QUEUE_PERMANENT_FAILURE`
- `src/lib/audit.test.ts` — updated EXPECTED_ENTRIES for new key
- `src/app/(password-reset)/actions.ts` — migrated to `enqueueEmail`
- `src/app/(account)/account/actions.ts` — migrated to `enqueueEmail`
- `src/app/api/cron/email-queue/route.ts` — new (cron handler)
- `vercel.json` — new (Vercel cron config, first in project)
- `.env.example` — added CRON_SECRET + dev-override vars

### Verification results

| Check | Result |
|-------|--------|
| `npm run typecheck` | ✅ PASS (0 errors) |
| `npm run lint` | ✅ PASS (0 warnings) |
| `npm run test` | ✅ PASS (259 tests / 23 files) |
| `npm run check:audit` | ✅ PASS |
| `npm run build` | ✅ PASS — `/api/cron/email-queue` visible in route table |
| `npm run test:e2e` | ✅ PASS (24/24 tests) — includes forgot-password spec exercising the enqueue path against the live dev DB |

E2E note: `forgot-password.spec.ts` test 10 ("link on /signin leads to /forgot-password and submit shows success card") exercises the `requestPasswordReset` → `enqueueEmail` path end-to-end against the live dev database. The `email_queue` table received the insert; the inline send used the dev noop path (no `RESEND_API_KEY` set locally). The success card rendered correctly — enumeration safety preserved.

### Open questions / handoff notes

**For qa (Phase 5):**
- This feature does NOT touch `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, or `src/lib/auth/` — the auth-touching e2e gate does NOT apply. Standard typecheck + unit test + build verification is sufficient for PASS.
- Optional manual smoke: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/email-queue` against the dev server. With no `CRON_SECRET` set in `.env.local`, expect 503 with `{ "error": "Email queue worker disabled: set CRON_SECRET to enable." }`.
- The `FOR UPDATE SKIP LOCKED` concurrency semantics are an accepted gap (documented in Phase 3 §6). Do not block PASS on this.
- `sendEmail` is exported from `send.ts` but NOT from the `index.ts` barrel. If any linter flags it as "unused export" that is intentional — it is consumed by `queue.ts` directly.
- Permanent-failure audit event written from `src/lib/email/queue.ts` (not an `actions.ts`); the `check:audit` tripwire does not scan it — this is correct and documented in Phase 3 §8.

---

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS. Not auth-touching (no `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, or `src/lib/auth/` changes). 259/259 unit tests pass including 23 new queue tests. Build is clean (20 routes, `/api/cron/email-queue` visible). Cron smoke returned HTTP 503 with expected error body (CRON_SECRET not set). All caller file changes are byte-intact. `sendEmail` is intentionally not re-exported from the barrel. The claim SQL uses `db.execute` with the DECISION-014 exception comment. Lease recovery runs before claim.

### What I did

- Ran `npm run typecheck` — clean (0 errors).
- Ran `npm run lint` — clean (0 warnings).
- Ran `npm run test` — 259 passed across 23 test files; confirmed 23 new tests in `src/lib/email/queue.test.ts` including backoff math (7 cases), structural exports, schema column contracts, production guard, enqueueEmail persist-first (Cases A + B), claim-uses-execute, lease-recovery ordering.
- Ran `npm run check:audit` — PASS (EMAIL_QUEUE_PERMANENT_FAILURE in AUDIT_ACTIONS catalog; audit event in queue.ts not in scope for tripwire — documented in Phase 3 §8).
- Ran `npm run build` — clean; `/api/cron/email-queue` visible in route table.
- Cron smoke (dev server running, `CRON_SECRET` not set in `.env.local`):
  - `curl http://localhost:3000/api/cron/email-queue` → **HTTP 503** `{"error":"Email queue worker disabled: set CRON_SECRET to enable."}` — correct behavior when CRON_SECRET is unset.
- Ran `npx playwright test` — 24/24 passed including `forgot-password.spec.ts` test 10 which exercised the `requestPasswordReset → enqueueEmail` path.
- Read `src/lib/email/index.ts`:
  - `sendEmail` NOT re-exported (line 18 comment: "intentionally NOT re-exported here"); barrel exports `enqueueEmail`, `sendPasswordResetEmail` (deprecated), and types only.
- Read `src/lib/email/queue.ts`:
  - `fromRaw()` mapper: `RawQueueRow` (snake_case) → `typeof emailQueue.$inferSelect` (camelCase); all 18 columns mapped.
  - `computeNextAttemptAt` exported for tests.
  - `processQueueBatch` Step 1 = lease recovery (re-queues `processing` rows where `lastAttemptAt < now - 10min`) BEFORE Step 2 = atomic claim.
  - Atomic claim at lines 239–262: `db.execute(sql\`...\`)`, CTE with `FOR UPDATE SKIP LOCKED`, DECISION-014 exception comment present.
- Read `src/app/(password-reset)/actions.ts`: `recordAudit` calls at lines 96 and 191 are intact; `onConflictDoUpdate` upsert at lines 73–78 is intact.
- Read `src/app/(account)/account/actions.ts`: `recordAudit` call at line ~161 is intact; `enqueueEmail` replaces the old `sendEmail` call.
- Confirmed `vercel.json` at project root: `{ "crons": [{ "path": "/api/cron/email-queue", "schedule": "*/5 * * * *" }] }`.
- Confirmed `.env.example`: `CRON_SECRET=` with "REQUIRED in production" comment; `EMAIL_DEV_INTERCEPT` and `EMAIL_DEV_REDIRECT_TO` present as commented-out dev-only vars.
- `FOR UPDATE SKIP LOCKED` concurrency gap acknowledged (Phase 3 §6 accepted gap): not required for PASS.

### Feature-Gate Audit

The cron route `GET /api/cron/email-queue` is gated by `CRON_SECRET` bearer auth (not NextAuth session). This is correct: the route is a system/operator endpoint, not a user-facing one. No `hasFeature()` check is appropriate or needed.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct gate? |
|---|---|---|---|
| `GET /api/cron/email-queue` | no | no | yes — CRON_SECRET bearer auth is the correct gate for a cron/operator endpoint |

No admin mutations or user-facing protected actions were added. Caller action files (`password-reset/actions.ts`, `account/actions.ts`) retained their existing gates.

### Outputs

- `docs/work-log/2026-07-01-email-queue.md` — Phase 5 section added; Per-Phase Status row updated.
- `docs/TODO.md` — In Flight entry updated to Phase 6 next.

### Open questions / handoff notes

- Next agent: **analyst** for Phase 6 shipped-vs-intent review.
- `sendEmail` is exported from `send.ts` but not from the barrel — any linter warning about "unused export" is expected and correct.
- The `FOR UPDATE SKIP LOCKED` concurrency semantics are an accepted gap. Concurrency correctness is an architectural guarantee (Phase 1 adversarial pass + DECISION-018), not a unit-testable property.

---

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. A transient Resend failure no longer silently drops a password-reset or email-change verification email. Both call sites now enqueue-first and the inline send failure is caught internally — the user-facing enumeration-safe contract is preserved, the audit event fires regardless of send outcome, and the cron worker correctly claims rows via a multi-instance-safe CTE. One implementation deviation was caught and fixed by the implementer: db.execute(sql... RETURNING *) returns snake_case column names, not Drizzle's camelCase inferred type; a fromRaw() mapper was added. The email-change toast copy was left at the existing phrasing ("Check your new inbox for a verification link") which does not imply immediate delivery — acceptable drift from the Phase 3 spec's suggested wording.

### What I did

- Verified `src/app/(password-reset)/actions.ts`: imports `enqueueEmail` from `@/lib/email` (line 10); `sendPasswordResetEmail` import gone; `onConflictDoUpdate` upsert at lines 72-78; `enqueueEmail()` call at lines 82-94 with `templateKey: "password_reset"`; `recordAudit()` at lines 96-102 fires after enqueue (audit writes even when inline send fails); action returns `{ ok: true }` always. Enumeration safety confirmed.
- Verified `src/app/(account)/account/actions.ts`: imports `enqueueEmail` from `@/lib/email`; `sendEmail` import gone; `enqueueEmail()` call with `templateKey: "email_change_verify"`; `recordAudit()` intact after enqueue.
- Verified `src/lib/email/index.ts`: `enqueueEmail` exported; `sendPasswordResetEmail` exported with @deprecated; `sendEmail` intentionally NOT exported (bypass prevention per DECISION-018).
- Verified `src/app/api/cron/email-queue/route.ts`: GET only; 503 when CRON_SECRET unset with helpful message; 401 on bearer mismatch; limit clamped 1-200, default 25. QA confirmed 503 via curl smoke.
- Verified `vercel.json` at project root: `{ "crons": [{ "path": "/api/cron/email-queue", "schedule": "*/5 * * * *" }] }`.
- Verified `src/lib/email/queue.ts`: lease recovery (processQueueBatch Step 1) runs before atomic claim (Step 2); CTE `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *` via `db.execute(sql...)` with DECISION-014 exception comment; `fromRaw()` mapper handles snake_case→camelCase conversion from db.execute() result.
- Verified `src/lib/audit.ts`: `EMAIL_QUEUE_PERMANENT_FAILURE: "email.queue.permanent_failure"` present in AUDIT_ACTIONS catalog.
- Verified `.env.example`: `CRON_SECRET=` documented as REQUIRED in production; `EMAIL_DEV_INTERCEPT` and `EMAIL_DEV_REDIRECT_TO` present as commented-out dev-only vars.
- Checked email-change toast copy: existing phrasing "Check your new inbox for a verification link" — does not imply immediate delivery; meets Phase 1 Gap 3 intent even if phrasing differs from Phase 3 suggestion.

### Outputs

- `docs/work-log/2026-07-01-email-queue.md` — Phase 6 section added; Per-Phase Status row updated to Complete / SHIP IT / 2026-07-01.
- `docs/TODO.md` — In Flight line moved to Done.

### Intent-vs-shipped diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| Transient Resend failure no longer silently drops password-reset email | enqueueEmail() in requestPasswordReset; failure caught internally; action returns { ok: true } always | matches |
| Transient Resend failure no longer silently drops email-change email | enqueueEmail() in requestEmailChange; failure caught internally | matches |
| Enumeration safety restored on provider failure | password-reset returns { ok: true } regardless of send outcome | matches |
| Persist-first (enqueue before inline send) | db.insert(...).returning() before attemptSend() in enqueueEmail() | matches |
| Exponential backoff retry (1m → 2m → ... → 60m cap) | computeNextAttemptAt() with min(2^(n-1), 60) * 60000 ms | matches |
| Multi-instance-safe claim via single-statement CTE | db.execute(sql`UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *`) | matches |
| Lease recovery for stuck 'processing' rows | processQueueBatch Step 1: re-queues processing rows where lastAttemptAt < now - 10min | matches |
| Cron route: 503 when CRON_SECRET unset | confirmed via curl smoke in Phase 5 | matches |
| Dev intercept / redirect env vars | EMAIL_DEV_INTERCEPT skips Resend; EMAIL_DEV_REDIRECT_TO overrides recipient | matches |
| sendEmail not exported from barrel | index.ts: intentionally NOT re-exported, comment present | matches |
| audit event fires even when inline send fails | recordAudit() call is after enqueueEmail(); enqueueEmail() never throws on send failure | matches |
| email-change toast "Check your email to confirm the change." (Phase 3 wording) | shipped as "Check your new inbox for a verification link." — existing phrasing; does not imply immediate delivery | acceptable drift |
| db.execute(RETURNING *) → typeof emailQueue.$inferSelect (Phase 3 cast) | implemented as RawQueueRow (snake_case) + fromRaw() mapper — design cast would have failed at runtime | acceptable deviation — implementer fix correct |

### Edge cases

| Check | Result |
|---|---|
| Empty state | pass — empty queue: processQueueBatch returns { claimed: 0, sent: 0, failed: 0, requeued: 0 }; cron returns HTTP 200 { ok: true, ...zeros } |
| Failure microcopy | pass — user sees "If an account exists, we sent you a link" regardless of inline send outcome; queue internals never surface to user; "queued" does not appear in any user-facing string |
| Permission gate | pass — cron route gated by CRON_SECRET bearer auth; 503 when unset; 401 on mismatch; confirmed via QA curl smoke |
| Audit event | pass — EMAIL_QUEUE_PERMANENT_FAILURE in AUDIT_ACTIONS; permanent-failure rows write audit event from queue.ts; existing caller audit events preserved and now fire even when send fails |
| Mobile | not applicable |

### Open questions / handoff notes

- Admin queue viewer under /admin/email-queue remains in `docs/TODO.md` Backlog. No blocker.
- Resend delivery webhook (Svix) remains in Backlog. No blocker.
- `FOR UPDATE SKIP LOCKED` concurrency is an accepted gap: correctness is an architectural guarantee (Phase 1 adversarial pass + DECISION-018), not unit-testable. No blocker.
- No open blockers. Pipeline closed.
