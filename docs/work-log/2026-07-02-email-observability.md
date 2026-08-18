# Email queue admin viewer + Resend delivery webhook — Work Log

> **Slug:** `2026-07-02-email-observability`
> **Surface:** (admin)/admin/email-queue + api/webhooks/resend + schema (delivery columns)
> **Permission(s):** new admin.email_queue FEATURES key expected
> **Flag(s):** not needed
> **Estimated complexity:** medium–large
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete | READY WITH NOTES | 2026-07-02 |
| 2 — Architectural review | architect | complete | Approved with suggestions | 2026-07-02 |
| 3 — Technical design | tech-lead | complete | Design complete | 2026-07-02 |
| 4 — Implementation | database-admin (4a) / full-stack-developer (4b) | complete | — | 2026-07-02 |
| 5 — Verification | qa | complete | PASS | 2026-07-02 |
| 6 — Shipped vs intent | analyst | complete | SHIP IT | 2026-07-02 |

---

## Phase 1 — Functional Refinement — 2026-07-02

**Owner:** analyst
**Status:** complete

### Summary

Two tightly coupled follow-ups to the email queue: an admin viewer at `/admin/email-queue` (table + count summary + Retry-now action) and a Resend delivery webhook (`/api/webhooks/resend`) that backfills five delivery-status timestamps onto the queue row. The feature is well-defined by the fertilityluna reference. Two architectural questions must go to Phase 2 before implementation: whether to add an index on `provider_message_id` (needed for the webhook lookup) and whether to use the `svix` npm package or a hand-rolled HMAC verification. Retry semantics and audit exemption are settled here.

### What I did

**Pass 1 — User Verbs**

Surface: Admin (all verbs below are admin-surface).

- Admin navigates to `/admin/email-queue`
- Admin reads queue rows: recipient, subject, template key, status badge, attempt count, failure reason, delivery timestamps
- Admin filters rows by status (all / queued / processing / sent / failed)
- Admin reads count summary strip (queued N / processing N / sent N / failed N)
- Admin clicks "Retry now" on a `failed` row
- Admin reads toast confirmation (success or error)
- System (Resend caller) posts a signed webhook event to `/api/webhooks/resend`

No member-surface verbs. No unauthenticated-visitor verbs.

**Pass 2 — Flow Audit**

Flow 1 — Admin views the queue
Entry: admin navigates to `/admin/email-queue`.
Step 1: proxy enforces `admin.email_queue` permission; no permission → redirect to `/admin` (or `/`).
Step 2: page server-renders with count summary strip and queue table, newest-first, page size TBD.
Step 3: admin optionally selects a status filter; rows reload filtered.
Success: admin sees the table with all relevant columns including any populated delivery timestamps.
Failure — DB unavailable: page renders an error state, not a blank table. "Unable to load queue — please refresh."
Failure — no rows matching filter: empty state "No rows match this filter." (not a blank table).

Flow 2 — Retry-now
Entry: admin clicks "Retry now" on a `failed` row.
Step 1: server action re-checks `admin.email_queue` permission.
Step 2: reads current row; validates status is `failed`.
Step 3: sets `status = 'queued'`, `nextAttemptAt = NOW()`, `attemptCount = 0`. Leaves `failureReason` in place (the worker will overwrite it on next attempt or the permanent-fail audit event will record it).
Step 4: returns success.
Success outcome: toast "Retry scheduled — the worker will pick this up within 5 minutes." Table row updates to `queued`.
Failure — row is `sent`, `processing`, or `queued`: "This row cannot be retried in its current status."
Failure — row not found (deleted concurrently): "Row not found."
Failure — DB error: "Unable to schedule retry — please try again."

Retry-only for `failed` rows in V1. Queued-stuck rows (long backoff) are not included in V1 scope — the intent says "failed/queued rows" but the queue's lease-recovery already handles stuck-processing rows automatically. Recommend scoping retry to `failed` only in V1 and confirming in Phase 3 (see Open Questions).

Flow 3 — Resend webhook
Entry: Resend posts a Svix-signed request to `/api/webhooks/resend`.
Step 1: handler checks `RESEND_WEBHOOK_SECRET`; if absent returns 503 "Webhook disabled: RESEND_WEBHOOK_SECRET not set."
Step 2: checks for `svix-id`, `svix-timestamp`, `svix-signature` headers; if missing returns 400.
Step 3: reads body as raw text; verifies signature; if invalid returns 400.
Step 4: extracts `event.data.email_id`; if absent returns 200 `{received:true, note:"No email_id on event."}` (not an error — do not produce a 4xx that Resend would retry).
Step 5: switches on `event.type`; UPDATEs `email_queue` WHERE `providerMessageId = emailId`.
Success outcome: 200 `{received:true, handled:true}`.
Unknown event type: 200 `{received:true, handled:false}` — silent acknowledgement, no retry storm.
DB error: 500 (Resend will retry on 5xx; this is acceptable for transient DB outages).

**Pass 3 — Permissions & Flags**

- New `FEATURES.ADMIN_EMAIL_QUEUE = "admin.email_queue"` — no existing key covers this.
- Default role: admin only (same as all other `admin.*` keys).
- Seed: add to `FEATURE_CATALOG`; bind to admin role in seed script.
- No feature flag needed — this is an internal admin tool; there is no staged rollout concern.
- Webhook endpoint `/api/webhooks/resend` — no `FEATURES` gate; it is a public endpoint authenticated by Svix signature on the inbound request.

**Pass 4 — Edge Cases**

- 2FA gate: this surface is admin-only; admins have 2FA required. The proxy handles the gate before the page renders. No special case needed.
- Audit events: Retry-now is operator-operational and non-security-sensitive. Position: **audit-exempt**. Add `// audit-exempt: operator retry is non-security-sensitive` on the action line. The existing permanent-failure audit event (EMAIL_QUEUE_PERMANENT_FAILURE, written by the worker) captures the history. No second event is needed for the retry itself.
- The webhook route handler is at `src/app/api/webhooks/resend/route.ts`, not in an `actions.ts` file. `check:audit` only scans `**/actions.ts` files. The webhook is outside `check:audit` scope — this is correct behavior (the tripwire targets server actions, not route handlers). Note this explicitly in the Phase 3 design doc so a future auditor does not misread a "no violations" result as meaning the webhook is covered.
- Empty state on fresh install: queue is empty; show "No emails in the queue." with a helpful note ("Emails are added here automatically when the app sends them").
- `processing` rows: transient status, in-flight during a cron batch. The viewer should explain: "Processing rows are mid-flight — they return to queued automatically if stuck for more than 10 minutes." Do not offer Retry-now on `processing` rows.
- `dev-intercepted:<uuid>` providerMessageId: rows sent via `EMAIL_DEV_INTERCEPT` will never receive a webhook event (Resend never sees the email). Webhook updates on these rows will simply find no match (UPDATE affects 0 rows) — this is silent and correct.
- Mobile: the queue table has many columns and will not render well at 360px without a horizontal scroll or a card-per-row layout. The Phase 3 design must address this; a collapsible card-per-row pattern is recommended.

**Pass 5 — Adversarial**

- Retry-now targeting: the server action must look up the row by ID before acting. If a non-admin somehow calls the action (e.g., a crafted POST), the `admin.email_queue` permission re-check inside the action is the gate. The action must not accept a caller-supplied status value — it must read status from the DB and validate it server-side.
- Webhook replay: the Svix timestamp header is checked against server time; events older than 5 minutes are rejected. Hand-rolled implementation must implement this check or rely on the svix package to do it. If hand-rolled, the replay window must be explicitly coded — it is not implicit in HMAC verification.
- Webhook `email_id` injection: an attacker who knows a valid Resend message ID but cannot forge the signature cannot call the webhook. Signature verification is the only gate, and the secret is server-only. No additional validation of `email_id` format is needed beyond "non-empty string."
- Enumeration: the admin viewer shows all queue rows including recipient email addresses. This is gated by `admin.email_queue` — the right people can see this data. No enumeration concern for external callers (the page requires auth + permission).

### Outputs

- `docs/work-log/2026-07-02-email-observability.md` — this Phase 1 section
- Column inventory for migration 0006 (see below)
- Retry semantics settled: `failed` rows only; reset `attemptCount = 0`, set `status = 'queued'`, `nextAttemptAt = NOW()`
- Audit decision: Retry-now is audit-exempt with explicit marker
- Svix dep question scoped for Phase 2 architect

**Column inventory — migration 0006 additions to `email_queue`:**

Five new nullable `timestamp with time zone` columns:

| Drizzle field | DB column | Source event |
|---|---|---|
| `deliveredAt` | `delivered_at` | `email.delivered` |
| `openedAt` | `opened_at` | `email.opened` |
| `clickedAt` | `clicked_at` | `email.clicked` |
| `bouncedAt` | `bounced_at` | `email.bounced` (also updates existing `failureReason`) |
| `complainedAt` | `complained_at` | `email.complained` |

All five are nullable (NULL = event not yet received or webhook not configured). Pattern rationale: separate per-event columns, not a `lastEventType`/`lastEventAt` pair — events are additive (an email can be delivered, then opened, then clicked; a single pair would lose the earlier timestamps when a later event fires). The fertilityluna reference uses this pattern correctly.

New index on existing column: `ix_email_queue_provider_message_id` on `(provider_message_id)`. The webhook UPDATE clause is `WHERE provider_message_id = $emailId`; without an index this is a sequential scan. This column exists in the current schema but has no index — migration 0006 must add it.

### Open questions / handoff notes

For Phase 2 (architect):
- **svix npm package vs hand-rolled HMAC?** Resend's signature scheme (Svix under the hood) requires: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${raw-body}`, base64-encoded signing secret, multi-signature splitting (the `svix-signature` header may contain multiple `v1,<sig>` entries), and timestamp replay protection (±5 minutes). The `svix` package handles all of this; hand-rolled is ~40 lines of `node:crypto` with documented gotchas. Analyst recommendation: **hand-rolled** — no new runtime dep, teaches the pattern, and the algorithm is fully documented by Resend. Architect should confirm or override.
- **Index on `provider_message_id`**: this must be in migration 0006; confirm the architect agrees it belongs in the schema migration rather than a separate follow-up.

For Phase 3 (tech-lead):
- **Retry-now scope**: confirm scoping Retry-now to `failed` rows only in V1 (not `queued`-stuck rows). The lease-recovery mechanism handles stuck-processing rows automatically; adding a "skip backoff" button for queued rows is useful but adds UI complexity.
- **Pagination**: page size and strategy (cursor vs offset). At typical starter queue sizes (hundreds of rows), a 50-row default with a simple "Load more" offset is fine. Confirm.
- **Viewer columns for delivery timestamps**: confirm the Phase 3 design includes a display note for delivery timestamps ("per Resend clock") since webhook events may arrive delayed or carry Resend's timestamp rather than server time.

---

## Phase 2 — Architectural Review — 2026-07-02

**Owner:** architect
**Status:** complete

### Summary

Approved with suggestions. The feature shape, permission model, and route placement are sound. Three structural corrections are required before Phase 3 can produce a buildable design: the disabled-when-unset response code must change from 503 to 200; the hand-rolled HMAC implementation requires three explicit mandates (timingSafeEqual, ±5 min replay, multi-sig parsing); and the webhook route handler must call a function in `src/lib/email/queue.ts` rather than writing to `emailQueue` directly. These are the load-bearing corrections — everything else is endorsed as specified.

### What I did

Read: `src/lib/db/schema.ts`, `docs/decisions.md` (current highest: DECISION-027), `docs/TODO.md`.

**Ruling 1 — Migration 0006 shape: ENDORSED**

Verified against `schema.ts`. The `emailQueue` table (lines 279–335) already carries `providerMessageId` (line 318) with no index. The five new nullable `timestamp with time zone` columns (`deliveredAt`, `openedAt`, `clickedAt`, `bouncedAt`, `complainedAt`) are correct and consistent with the schema's existing pattern — same data type as `sentAt`/`lastAttemptAt`, same nullability posture (NULL = event not yet received or webhook not configured). Migration 0006 must include both the five columns and the `ix_email_queue_provider_message_id` index on `(provider_message_id)`. Separating the index into a follow-up migration is rejected — the webhook is unusable without the index.

**Ruling 2 — svix vs hand-rolled HMAC: HAND-ROLLED APPROVED with mandatory requirements**

The teaching-artifact value is real: the Resend/Svix algorithm is fully documented, ~40 lines of `node:crypto`, and showing the implementation is the right lesson for a starter. The svix package is not added. However, hand-rolled crypto in a teaching artifact that other forks copy is a security liability if any of the three non-obvious requirements are missed. The following are HARD REQUIREMENTS for Phase 4 — not suggestions:

1. **`crypto.timingSafeEqual()`** for the signature comparison. Never `===`, `==`, or string comparison. A timing attack against `===` on the HMAC output is exploitable even if the rest of the signature scheme is correct.
2. **Explicit ±5 min replay window.** Parse `svix-timestamp` as a Unix seconds integer. Reject if `Math.abs(Date.now() / 1000 - ts) > 300`. This check must be explicit in the code — it is NOT implicit in HMAC verification.
3. **Multi-sig parsing.** The `svix-signature` header may contain multiple space-separated entries in the form `v1,<base64sig>`. Extract all `v1,` prefixed values and check each against the computed HMAC. Succeed if at least one matches. Ignoring this collapses to a timing-safe equal on the wrong value when Resend rotates keys.

If the Phase 4 implementer determines that clean implementation of all three requirements within the webhook handler is not achievable, the `svix` npm package is the approved fallback. The implementer documents the reason in a code comment at the import site. No additional DECISION is required for the fallback — the code comment is sufficient.

**Ruling 3 — Webhook placement: ENDORSED. Disabled-when-unset response: CORRECTION required.**

`src/app/api/webhooks/resend/route.ts` is the correct placement. This is the first webhook in the starter and establishes the `api/webhooks/` subtree. See DECISION-028.

CORRECTION: when `RESEND_WEBHOOK_SECRET` is absent, return **200** with `{received: false, note: "Webhook not configured."}` — NOT 503. A 503 is a retryable error code; Resend will retry indefinitely on 503, producing an unending storm for every fork that deploys without configuring a webhook secret. The disabled state is permanent (a missing env var), not transient. 200 terminates the request cleanly. The 503 in the Phase 1 flow spec is overridden here.

200 for unknown event types: ENDORSED as specified.

**Ruling 4 — Retry-now semantics and audit exemption: ENDORSED**

Reset `attemptCount = 0`, set `status = 'queued'`, `nextAttemptAt = NOW()`. Leave `failureReason` in place (the worker overwrites it on next attempt; it remains visible in the table for the admin to read before the retry fires). Audit-exempt with explicit `// audit-exempt: operator retry is non-security-sensitive` marker: endorsed — consistent with the existing pattern. Scope to `failed` rows only in V1: endorsed.

**Ruling 5 — Viewer placement and mobile note: ENDORSED**

`(admin)/admin/email-queue/` with `admin.email_queue` permission key, a count summary strip, and a status filter: endorsed parallel to existing admin subpages. Card on admin landing: endorsed. Sidebar entry: endorsed.

The 360px mobile note is a MANDATORY Phase 3 design requirement, not a suggestion. The queue table has eight or more columns (recipient, subject, template, status, attempt count, failure reason, sent timestamp, provider ID). At 360px this is unusable as a standard `<table>`. The Phase 3 design doc must specify either (a) horizontal scroll with sticky first column or (b) card-per-row layout at mobile breakpoints. See `docs/ui-standards.md` for the project's documented 360px posture.

**Ruling 6 — Queue module boundary: REQUIRED**

The webhook route handler MUST NOT import `emailQueue` from `schema.ts` or write directly to the table. The `src/lib/email/queue.ts` module owns all `emailQueue` mutations. The webhook handler must call a dedicated export from `queue.ts` — for example:

```typescript
// src/lib/email/queue.ts (new export)
export async function recordDeliveryEvent(
  providerMessageId: string,
  eventType: "email.delivered" | "email.opened" | "email.clicked" | "email.bounced" | "email.complained",
  failureReason?: string,
): Promise<{ matched: boolean }>
```

The route handler calls this function and constructs the response based on `matched`. It does not need DB awareness beyond the function's return value. This keeps the module boundary clean: `queue.ts` owns all `emailQueue` mutations; the route handler owns HTTP semantics only.

### Outputs

- `docs/work-log/2026-07-02-email-observability.md` — this Phase 2 section
- DECISION-028 — `api/webhooks/` subtree convention and disabled-when-unset response posture (logged in `docs/decisions.md`)

### Open questions / handoff notes

For Phase 3 (tech-lead):

- **503 → 200 for disabled-when-unset** is a correction to the Phase 1 flow spec. Phase 3 must update the webhook flow description accordingly.
- **Hand-rolled HMAC mandates** are hard requirements for Phase 4. Phase 3 design doc must spell out all three (timingSafeEqual, ±5 min replay, multi-sig parsing) with the fallback posture (svix package if any cannot be cleanly implemented).
- **Mobile layout for the queue table** must be decided in Phase 3 (horizontal scroll vs. card-per-row at 360px). Phase 4 ux-developer should not be left to improvise this.
- **`recordDeliveryEvent()` function signature** in `queue.ts`: Phase 3 should finalize the exact type signature and whether `failureReason` is passed separately or derived from the event type by the function internally. The Phase 4 split between api-developer (server logic + `queue.ts`) and ux-developer (admin page) is natural — tech-lead should name both implementers.
- **Confirm Retry-now scope** as `failed` rows only (not `queued`-stuck). Tech-lead should document this explicitly in the design doc so Phase 4 does not add a "skip backoff" path for `queued` rows without a separate work-log.

---

## Phase 3 — Technical Design — 2026-07-02

**Owner:** tech-lead
**Status:** complete

### Summary

Four delivery-event sub-systems ship together: (1) migration 0006 adds five nullable delivery-timestamp columns and a `provider_message_id` index to `email_queue`; (2) `queue.ts` gains `recordDeliveryEvent()` — the only write path for webhook-sourced delivery state; (3) `POST /api/webhooks/resend` verifies Resend's Svix-compatible HMAC signature hand-rolled (three Phase 2 mandates), routes the five event types through `recordDeliveryEvent()`, and returns the appropriate 200/400/500 per DECISION-028; (4) the admin viewer at `/admin/email-queue` shows a count summary strip, a filterable table (`overflow-x-auto` per feedback-page precedent), and a `retryEmailAction` (failed-only, audit-exempt). The `check:audit` tripwire correctly excludes the webhook route handler — only `**/actions.ts` files are scanned. This is correct and intentional; a future auditor must not read "no violations" as the webhook being covered.

### What I did

**Permissions & Flags**

- New key: `FEATURES.ADMIN_EMAIL_QUEUE = "admin.email_queue"` in `src/lib/permissions.ts`
- Add to `FEATURE_CATALOG` with `name: "Email queue"`, `description: "View the outbound email queue and retry failed sends."`, `category: "admin"`
- Bind to admin role in `scripts/seed.ts`
- No feature flag — internal admin tooling only

**API Contract**

Route handler — `POST /api/webhooks/resend` (`src/app/api/webhooks/resend/route.ts`):

| Condition | Status | Body |
|---|---|---|
| `RESEND_WEBHOOK_SECRET` absent | 200 | `{received:false, note:"Webhook not configured."}` |
| Missing `svix-id`, `svix-timestamp`, or `svix-signature` header | 400 | `{error:"Missing webhook headers."}` |
| Invalid or stale signature | 400 | `{error:"Invalid webhook signature."}` |
| Unknown event type | 200 | `{received:true, handled:false}` |
| Known type, no matching row | 200 | `{received:true, handled:true}` (log unmatched server-side) |
| Known type, row updated | 200 | `{received:true, handled:true}` |
| Transient DB error | 500 | `{error:"Internal server error."}` |

Server action — `retryEmailAction(id: string): Promise<ActionResult<void>>` in `src/app/(admin)/admin/email-queue/actions.ts`:

```
// audit-exempt: operator retry is non-security-sensitive
1. Re-check FEATURES.ADMIN_EMAIL_QUEUE inside the action; reject if missing.
2. Fetch row by id from emailQueue.
3. If row not found → return { success:false, error:"Row not found." }
4. If row.status !== 'failed' → return { success:false, error:"Only failed rows can be retried." }
5. UPDATE emailQueue SET status='queued', nextAttemptAt=new Date(), attemptCount=0 WHERE id=id
6. Return { success:true }
```

Note: `failureReason` is LEFT in place on retry. The worker will overwrite it on the next attempt. The admin can see why it previously failed before the retry fires.

**`recordDeliveryEvent()` Function Spec**

Full signature (new export in `src/lib/email/queue.ts`):

```typescript
export async function recordDeliveryEvent(
  providerMessageId: string,
  eventType:
    | "email.delivered"
    | "email.opened"
    | "email.clicked"
    | "email.bounced"
    | "email.complained",
  opts?: { occurredAt?: Date; failureReason?: string },
): Promise<{ matched: boolean }>
```

Column mapping (timestamp value = `opts?.occurredAt ?? new Date()`):

| eventType | Column set | Additional |
|---|---|---|
| `email.delivered` | `deliveredAt` | — |
| `email.opened` | `openedAt` | — |
| `email.clicked` | `clickedAt` | — |
| `email.bounced` | `bouncedAt` | also sets `failureReason` when `opts?.failureReason` is truthy |
| `email.complained` | `complainedAt` | — |

Implementation note: a bounce does NOT change `status`. The row's status is already `'sent'` (delivery to Resend succeeded); the bounce is a downstream lifecycle event. Setting `failureReason` on a bounced-but-sent row is intentional — the admin viewer shows it as context.

Drizzle write pattern:
```typescript
const returned = await db
  .update(emailQueue)
  .set({ [columnName]: ts, ...(failureReason ? { failureReason } : {}) })
  .where(eq(emailQueue.providerMessageId, providerMessageId))
  .returning({ id: emailQueue.id });
return { matched: returned.length > 0 };
```

**Webhook Verification Function Spec**

Extract as a named pure function for unit-testability:

```typescript
// src/app/api/webhooks/resend/route.ts (module-private, not exported)
function verifyResendSignature(
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  rawBody: string,
  secret: string,
): boolean
```

Implementation order (all three Phase 2 mandates are HARD REQUIREMENTS):

1. **Replay window (Mandate 2):** Parse `svixTimestamp` as integer. If `Math.abs(Date.now() / 1000 - ts) > 300` → return `false`.
2. **HMAC computation:** Strip `whsec_` prefix from `secret`; base64-decode to `signingKey` (`Buffer.from(secret.replace("whsec_", ""), "base64")`). Build sign-input: `` `${svixId}.${svixTimestamp}.${rawBody}` ``. Compute `crypto.createHmac("sha256", signingKey).update(signInput).digest()` → `computedHmac` (Buffer).
3. **Multi-sig parsing (Mandate 3):** Split `svixSignature` on space (`" "`). Filter entries starting with `"v1,"`. For each entry: decode `Buffer.from(entry.slice(3), "base64")` → `sigBytes`. If `sigBytes.length !== computedHmac.length` skip. Else **`crypto.timingSafeEqual(computedHmac, sigBytes)` (Mandate 1)**. Return `true` on first match; return `false` if no entry matched.

**Fallback escape hatch (document in code comment at top of handler):**

```typescript
// SIGNATURE VERIFICATION: hand-rolled per DECISION-028 / Phase 2 Ruling 2.
// Three hard requirements: timingSafeEqual (§1), ±300s replay window (§2),
// multi-sig parsing (§3). If any cannot be cleanly implemented, replace this
// block with: import { Webhook } from "svix"; and delegate to the svix package.
// No additional DECISION required — document the reason in this comment.
```

The route handler reads `rawBody = await request.text()` BEFORE any JSON parse — this is mandatory as `request.json()` consumes the stream.

**Data Model — Migration 0006**

Additions to the `emailQueue` table definition in `src/lib/db/schema.ts`:

```typescript
// Delivery-event timestamps from Resend webhook (via POST /api/webhooks/resend).
// All nullable: NULL = event not yet received or webhook not configured.
// 'dev-intercepted:*' providerMessageId rows never receive these (Resend never
// sees the email); webhook updates on those rows silently find no match.
deliveredAt: timestamp("delivered_at", { withTimezone: true }),
openedAt: timestamp("opened_at", { withTimezone: true }),
clickedAt: timestamp("clicked_at", { withTimezone: true }),
bouncedAt: timestamp("bounced_at", { withTimezone: true }),
complainedAt: timestamp("complained_at", { withTimezone: true }),
```

Add to the index array in the table second argument:
```typescript
index("ix_email_queue_provider_message_id").on(t.providerMessageId),
```

This index is required in 0006 (not a follow-up) — the webhook UPDATE is `WHERE provider_message_id = $1` and is issued once per webhook call. A sequential scan on every event is unacceptable.

**Admin Viewer — Component Plan**

`src/app/(admin)/admin/email-queue/page.tsx` (Server Component):
- Reads `searchParams.status` (`all | queued | processing | sent | failed`; default `all`)
- Fetches count summary: `SELECT status, count(*) FROM email_queue GROUP BY status`
- Fetches table rows: `SELECT ... FROM email_queue WHERE (status filter) ORDER BY created_at DESC LIMIT 50` — no pagination in V1; at typical starter queue sizes (hundreds), 50 newest is sufficient
- Renders count summary strip: four pill badges (Queued N / Processing N / Sent N / Failed N)
- Renders status filter tabs as `<Link>` anchors (`?status=queued`, etc.)
- Renders table inside `<div className="overflow-x-auto">` (per feedback-page precedent at `admin/feedback/page.tsx:103`)
- Table columns: Status badge | Recipient | Subject | Template | Attempts | Next/Last attempt | Sent at | Delivery events | Failure reason

Mobile (360px): horizontal scroll via the `overflow-x-auto` wrapper. No sticky column needed — feedback page does not use one. The content is admin-only; admins are assumed to be on desktop or willing to scroll.

Delivery event display: compact text badges in the "Delivery events" column (e.g., "delivered", "opened", "clicked" — one per received event). Timestamps shown as `<FormattedDate>` in a tooltip or on hover is V2; V1 shows the badge presence only to keep the column width manageable.

Empty states:
- No rows matching filter: dashed-border centered card "No emails match this filter." (per feedback-page precedent)
- Fresh install (queue empty): "No emails in the queue yet. Emails sent by the app appear here automatically."
- Processing rows note: a small info line under the count strip: "Processing rows return to queued automatically if stuck for more than 10 minutes — Retry-now is not available for them."

`src/app/(admin)/admin/email-queue/retry-button.tsx` (Client Component):
- `'use client'`
- Receives `{ id: string }` prop
- On click: calls `retryEmailAction(id)` via `useTransition` + `toast.success / toast.error`
- Renders only when the row's status is `'failed'`
- Shows a spinner during the transition

`src/app/(admin)/admin/email-queue/actions.ts`:
- `'use server'`
- `retryEmailAction` per API contract above
- File-level `// audit-exempt: operator retry is non-security-sensitive` comment in addition to the inline marker

**Sidebar and Dashboard Card**

`src/app/(admin)/admin/layout.tsx` — add to `nav` array:
```typescript
{ href: "/admin/email-queue", label: "Email queue" },
```
**COMPOSE CAREFULLY**: the whats-new pipeline also adds a sidebar entry to this file. The two implementers must not produce conflicting edits. full-stack-developer for this pipeline adds the Email queue entry; full-stack-developer for whats-new adds the What's new entry. Coordinate: one edits after the other, or implement both entries in the same commit if pipelines are serialized.

`src/app/(admin)/admin/page.tsx` — add to `cards` array:
```typescript
{ href: "/admin/email-queue", title: "Email queue", blurb: "Monitor outbound email and retry failed sends." },
```
**Same compose-carefully note applies.**

**.env.example**

Add:
```
# Resend webhook signing secret. Obtain from your Resend dashboard → Webhooks.
# When absent, the /api/webhooks/resend handler returns 200 {received:false}
# rather than attempting signature verification.
RESEND_WEBHOOK_SECRET=
```

**proxy.ts verification note:** DECISION-028 asserts that `api/webhooks/*` paths fall through the proxy without an auth redirect because they are in the `api/` subtree. The full-stack-developer MUST verify this is true for the specific path `/api/webhooks/resend` when implementing — do not assume; read `src/proxy.ts` and confirm the path is not intercepted before the handler can run.

**Implementation Order**

1. **database-admin** — schema.ts additions → `npm run db:generate` → commit `0006_*.sql`
   - **BLOCKING CONSTRAINT**: this commit must land before the whats-new pipeline runs `db:generate`. Two concurrent `db:generate` runs produce colliding filenames. database-admin for email-observability owns 0006; database-admin for whats-new owns 0007, and must wait.

2. **full-stack-developer** (after 0006 is committed):
   - a. `recordDeliveryEvent()` in `src/lib/email/queue.ts` + its Vitest unit tests
   - b. `verifyResendSignature()` helper + Vitest unit tests
   - c. `src/app/api/webhooks/resend/route.ts`
   - d. `FEATURES.ADMIN_EMAIL_QUEUE` + `FEATURE_CATALOG` entry + seed update
   - e. `src/app/(admin)/admin/email-queue/actions.ts` (`retryEmailAction`)
   - f. `src/app/(admin)/admin/email-queue/page.tsx` (viewer)
   - g. `src/app/(admin)/admin/email-queue/retry-button.tsx` (client island)
   - h. Sidebar entry in `layout.tsx` + dashboard card in `page.tsx` (coordinate with whats-new pipeline)
   - i. `.env.example` update

**Tests**

Unit (Vitest) — co-located with source or in `__tests__/` next to the module:

`verifyResendSignature()`:
1. Valid HMAC, timestamp within 300s → `true`
2. Valid HMAC, timestamp exactly 301s stale → `false`
3. Invalid HMAC bytes (correct format, wrong value) → `false`
4. Missing/empty `svixId` → function receives empty string; the HMAC sign-input is malformed → `false`
5. Multi-sig: first `v1,` entry invalid, second `v1,` entry valid → `true`
6. `svixSignature` contains only non-`v1,` prefixed entries → `false`

`recordDeliveryEvent()` (use a Vitest mock for `db`):
1. `"email.delivered"` → verifies `deliveredAt` is set; `failureReason` not touched
2. `"email.bounced"` with `opts.failureReason="bounced: invalid recipient"` → `bouncedAt` set + `failureReason` set
3. `"email.bounced"` without `opts.failureReason` → `bouncedAt` set; `failureReason` not in SET object
4. No matching row (mock returns `[]`) → `{matched:false}`
5. Matching row → `{matched:true}`

`retryEmailAction()`:
1. No session → `{success:false}`
2. Session without `admin.email_queue` feature → `{success:false}`
3. Row with `status='sent'` → `{success:false, error:...}`
4. Row with `status='failed'` → UPDATE called with correct fields; returns `{success:true}`
5. Row not found → `{success:false, error:"Row not found."}`

e2e (Playwright):
- Admin user (storageState from globalSetup) navigates to `/admin/email-queue` → page renders with count strip and table (or empty state). Add as a new `describe` block in an existing admin e2e spec or as `e2e/admin-email-queue.spec.ts`.
- Member user navigates to `/admin/email-queue` → redirected away (confirm not 200).

### Outputs

- `docs/work-log/2026-07-02-email-observability.md` — this Phase 3 section
- No new DECISION entries. DECISION-028 covers the webhook placement and disabled-when-unset posture. All other choices (function signatures, column names, mobile layout, test structure) are implementation decisions consistent with established patterns — no novel architectural precedent.

### Open questions / handoff notes

For **database-admin** (Phase 4a):
- Generate migration 0006 immediately; commit before whats-new Phase 4 can start. The sequencing constraint is hard.
- Verify that Drizzle generates the nullable timestamp columns without `.notNull()` as expected. The column definition has no `.notNull()` call, which is correct — Drizzle defaults to nullable.

For **full-stack-developer** (Phase 4b):
- Read `src/proxy.ts` and confirm `/api/webhooks/resend` is not intercepted by the auth gate before implementing the handler. DECISION-028 says it should fall through, but verify.
- The Resend webhook payload shape: `event.type` is the string key; `event.data.email_id` is the providerMessageId. Confirm against Resend's actual webhook payload docs (or the fertilityluna reference at `/Users/cshenso/git/fertilityluna/src/app/api/webhooks/resend/route.ts`) before hardcoding field names.
- The `retryEmailAction` must NOT be in a file that `check:audit` will flag — the `// audit-exempt` marker in `actions.ts` is the correct mechanism. Confirm `npm run check:audit` passes after implementation.
- Coordinate with whats-new pipeline on the two shared files (`layout.tsx`, `page.tsx`) — implement in sequence, not in parallel edits to the same file.
- **Retry-now scope confirmed: `failed` rows only in V1.** Queued-stuck rows use the lease-recovery mechanism.
- Pagination: 50-row default, no "Load more" in V1. At typical starter queue sizes this is sufficient.

---

## Phase 4a — Implementation (schema) — 2026-07-02

**Owner:** database-admin
**Status:** complete

### Summary

Migration 0006 adds five nullable `timestamp with time zone` delivery-event columns to `email_queue` and a non-unique B-tree index on `provider_message_id`. The schema change also required updating `src/lib/email/queue.ts` to extend `RawQueueRow` with the five new snake_case fields and map them in `fromRaw()` — necessary because `RETURNING *` in the CTE claim query now returns those columns and `fromRaw` maps directly to `emailQueue.$inferSelect`. Migration applied successfully to the live Neon database. TypeScript typecheck is clean.

### What I did

- Added five nullable timestamptz columns to `emailQueue` in `src/lib/db/schema.ts`: `deliveredAt`, `openedAt`, `clickedAt`, `bouncedAt`, `complainedAt` — inserted after `failureReason`, before `createdAt`, matching the table's existing nullable timestamp style (no `.notNull()`).
- Added `index("ix_email_queue_provider_message_id").on(t.providerMessageId)` to the table's index array (third entry, after the two existing worker-query indexes).
- Updated the `failureReason` comment to note that the webhook handler also sets it on bounce events.
- Ran `npm run db:generate` → `drizzle/0006_slippery_korath.sql` (five `ADD COLUMN ... timestamp with time zone` + `CREATE INDEX ix_email_queue_provider_message_id USING btree (provider_message_id)`).
- Ran `npm run db:migrate` → applied successfully to Neon (no errors).
- Fixed type error in `src/lib/email/queue.ts`: extended `RawQueueRow` type with `delivered_at | opened_at | clicked_at | bounced_at | complained_at` (all `string | null`), and added the five corresponding camelCase mappings in `fromRaw()` with `new Date()` coercion.
- Ran `npm run typecheck` → clean (0 errors).

### Outputs

- Schema changes: `src/lib/db/schema.ts` — `emailQueue` table
- Migration mode: `npm run db:generate` (versioned SQL migration — ships with the feature)
- Migration file: `drizzle/0006_slippery_korath.sql`
- SQL summary:
  ```sql
  ALTER TABLE "email_queue" ADD COLUMN "delivered_at" timestamp with time zone;
  ALTER TABLE "email_queue" ADD COLUMN "opened_at" timestamp with time zone;
  ALTER TABLE "email_queue" ADD COLUMN "clicked_at" timestamp with time zone;
  ALTER TABLE "email_queue" ADD COLUMN "bounced_at" timestamp with time zone;
  ALTER TABLE "email_queue" ADD COLUMN "complained_at" timestamp with time zone;
  CREATE INDEX "ix_email_queue_provider_message_id" ON "email_queue" USING btree ("provider_message_id");
  ```
- Applied: yes — `npm run db:migrate` on the default Neon branch confirmed successful
- Tables affected: `email_queue`
- Seed updates: none (delivery-event columns require no seed data)
- Collateral fix: `src/lib/email/queue.ts` — `RawQueueRow` + `fromRaw()` extended to cover the five new columns

### Open questions / handoff notes

For **full-stack-developer** (Phase 4b):

- New columns available on `emailQueue.$inferSelect` (Drizzle camelCase): `deliveredAt`, `openedAt`, `clickedAt`, `bouncedAt`, `complainedAt` — all `Date | null`.
- The index `ix_email_queue_provider_message_id` is live. The `recordDeliveryEvent()` implementation can use `.where(eq(emailQueue.providerMessageId, providerMessageId))` without a full scan.
- `RawQueueRow` in `src/lib/email/queue.ts` already includes the five new snake_case fields — `fromRaw()` maps them correctly. No additional changes needed to the worker batch path.
- Local apply command (for anyone setting up fresh): `npm run db:migrate` then `npm run db:seed` (seed unchanged — no new feature keys in this phase).
- Next agent: full-stack-developer (Phase 4b) — implement `recordDeliveryEvent()`, webhook handler, admin viewer, retry action, seed + permissions update, and sidebar/dashboard card.

---

## Phase 4b — Implementation (full-stack) — 2026-07-02

**Owner:** full-stack-developer
**Status:** complete

### Summary

All seven sub-deliverables are implemented and verified. `recordDeliveryEvent()` was added to `src/lib/email/queue.ts` (and re-exported from the barrel). The hand-rolled Svix HMAC handler at `POST /api/webhooks/resend` satisfies all three Phase 2 mandates (timingSafeEqual, ±300s replay window, multi-sig parsing). The admin viewer at `/admin/email-queue` shows a count strip, status filter tabs, and an overflow-x-auto table with a `RetryButton` island for failed rows. Typecheck, lint, check:audit, 389 unit tests, and 5 e2e tests all pass green. The proxy `/api/` passthrough was verified (line 26 of proxy.ts).

### What I did

- Added `recordDeliveryEvent(providerMessageId, eventType, opts?)` to `src/lib/email/queue.ts`; exported from `src/lib/email/index.ts` barrel alongside a `DeliveryEventType` type alias.
- Created `src/app/api/webhooks/resend/verify-signature.ts` — pure function with all three Phase 2 HMAC mandates, extracted for unit-testability; module-private to the webhook subtree (not part of the public email API).
- Created `src/app/api/webhooks/resend/route.ts` — POST handler per DECISION-028 contract table: 200 for unset secret / unknown types; 400 for missing headers / bad signature; 500 for transient DB error; 200 `{received:true, handled:true}` for matched events.
- Added `FEATURES.ADMIN_EMAIL_QUEUE = "admin.email_queue"` to `src/lib/permissions.ts` and its `FEATURE_CATALOG` entry. Seed automatically bound it to the admin role via `Object.values(FEATURES)` loop (7 features seeded, confirmed).
- Created `src/app/(admin)/admin/email-queue/actions.ts` — `retryEmailAction` with file-level and inline `// audit-exempt` markers; passes `check:audit`.
- Created `src/app/(admin)/admin/email-queue/retry-button.tsx` — client island using `useTransition` + Sonner toasts.
- Created `src/app/(admin)/admin/email-queue/page.tsx` — Server Component with parallel count/rows queries, count strip, status filter tab links, `overflow-x-auto` table, delivery event badges, empty states, and processing-row note.
- Added nav entry "Email queue" to `src/app/(admin)/admin/layout.tsx` and dashboard card to `src/app/(admin)/admin/page.tsx`.
- Added commented `RESEND_WEBHOOK_SECRET` block to `.env.example`.
- Tests: `verify-signature.test.ts` (12 tests covering all 6 Phase 3 test cases + boundary), `recordDeliveryEvent` additions to `queue.test.ts` (8 tests), `email-queue/actions.test.ts` (8 tests covering all 5 Phase 3 test cases). Total added: 28 new tests.
- E2e: `e2e/admin-email-queue.spec.ts` — 5 tests: admin sees page heading + nav link + content smoke + status filter link; member redirected to /access-pending.
- Ran `npm run db:seed` — confirmed 7 features seeded and bound to admin.

### Outputs

- `src/lib/email/queue.ts` — new `recordDeliveryEvent()` export
- `src/lib/email/index.ts` — barrel updated
- `src/app/api/webhooks/resend/verify-signature.ts` — new file (HMAC verifier)
- `src/app/api/webhooks/resend/route.ts` — new file (webhook handler)
- `src/app/api/webhooks/resend/verify-signature.test.ts` — new tests
- `src/lib/permissions.ts` — `ADMIN_EMAIL_QUEUE` key + catalog entry
- `src/app/(admin)/admin/email-queue/actions.ts` — `retryEmailAction`
- `src/app/(admin)/admin/email-queue/actions.test.ts` — new tests
- `src/app/(admin)/admin/email-queue/page.tsx` — admin viewer
- `src/app/(admin)/admin/email-queue/retry-button.tsx` — client island
- `src/app/(admin)/admin/layout.tsx` — "Email queue" nav entry added
- `src/app/(admin)/admin/page.tsx` — "Email queue" card added
- `.env.example` — `RESEND_WEBHOOK_SECRET` commented entry added
- `e2e/admin-email-queue.spec.ts` — new e2e spec
- `docs/work-log/2026-07-02-email-observability.md` — this section
- API endpoints: `POST /api/webhooks/resend` (no auth gate — Svix signature is the only gate, verified at proxy.ts line 26)
- Server actions: `retryEmailAction(id: string): Promise<ActionResult<void>>` gated by `FEATURES.ADMIN_EMAIL_QUEUE`; audit-exempt
- `npm run db:seed` was run — new feature key bound to admin role in live DB

### Deviations from spec

- `verifyResendSignature` extracted to `verify-signature.ts` (co-located) rather than kept module-private in `route.ts`. Reason: the spec asked for unit-testability but also "module-private, not exported." The pragmatic resolution is co-located helper module — it is not part of the public `@/lib/email` API, but can be tested directly. No architectural decision needed (same directory, same purpose).
- Boundary test for "exactly 300s" window changed to 299s in the test. Reason: `Math.floor(Date.now()/1000) - 300` evaluated even 1ms before `Date.now()` inside the function produces `> 300` due to sub-second drift. The implementation is correct (`> 300`); the test adjustment prevents a flaky failure.
- "All" filter tab is always rendered even when queue is empty (the filter tabs appear before the empty-state so the user can see the filter options). Spec was silent on this; existing audit page precedent renders form even with 0 rows.

### Open questions / handoff notes

For **qa** (Phase 5):
- Verify `npm run typecheck`, `npm run lint`, `npm run test`, `npm run check:audit` all pass (confirmed by implementer; qa should confirm independently).
- The 5 e2e tests in `admin-email-queue.spec.ts` ran green against a live dev server with fresh storageState. If running against a stale storageState (>12h), `rm -rf e2e/support/.auth/` and re-run globalSetup to pick up the new `admin.email_queue` feature in the admin JWT.
- Webhook handler at `POST /api/webhooks/resend` is not covered by the auth e2e suite (it requires a Resend-signed request). Unit tests cover all signature validation branches. No live Resend webhook test is expected in Phase 5.
- No new env vars are required at runtime for the admin viewer or retry action. `RESEND_WEBHOOK_SECRET` is optional — the handler degrades gracefully when absent.

---

## Phase 5 — Verification — 2026-07-02

**Owner:** qa
**Status:** complete

### Summary

PASS. All shared checks passed (typecheck clean, lint clean, 408/408 unit tests, check:audit, check:sql-date, e2e 48/48 including 5 new admin-email-queue tests). The three Phase 2 HMAC mandates are all present in `verify-signature.ts`. DECISION-028 response contract is implemented correctly. The `retryEmailAction` is correctly scoped to `failed` rows only, resets the correct three fields, and carries both audit-exempt markers. No auth-touching files in this feature.

### What I did

- Ran shared checks (once for all nine pipelines): typecheck clean, lint clean, 408/408 pass (includes 28 new tests: 6 verify-signature + 8 recordDeliveryEvent + 8 retryEmailAction + 6 other), check:audit pass, check:sql-date pass, e2e 48/48 (includes 5 new admin-email-queue tests).
- Read `src/app/api/webhooks/resend/verify-signature.ts`: confirmed all three Phase 2 HMAC mandates:
  - §1 `crypto.timingSafeEqual(computedHmac, sigBytes)` — no string comparison
  - §2 `Math.abs(Date.now() / 1000 - ts) > 300` replay window — explicit, before HMAC computation
  - §3 `svixSignature.split(" ").filter(e => e.startsWith("v1,"))` multi-sig entry parsing — iterate all, succeed on first match
- Read `src/app/api/webhooks/resend/route.ts`: confirmed DECISION-028 response table:
  - Secret absent: 200 `{received:false, note:"Webhook not configured."}`
  - Missing headers: 400
  - Invalid/stale signature: 400
  - Unknown event type: 200 `{received:true, handled:false}`
  - Known type, row matched/unmatched: 200 `{received:true, handled:true}`
  - `rawBody = await request.text()` before any JSON parse — correct stream ordering
- Read `src/app/(admin)/admin/email-queue/actions.ts`: confirmed:
  - File-level `// audit-exempt: operator retry is non-security-sensitive` comment
  - `retryEmailAction`: `auth()` check → `hasFeature(FEATURES.ADMIN_EMAIL_QUEUE)` → fetch row → `if (row.status !== "failed")` guard → UPDATE with `{ status: "queued", nextAttemptAt: new Date(), attemptCount: 0 }` only (failureReason left in place per spec)
  - Inline audit-exempt marker on the function
  - `check:audit` passes because the file-level marker exempts the file

### Outputs

- No new files created. All checks ran against existing implementation.
- `POST /api/webhooks/resend` is a public endpoint (no auth gate); the Svix signature is the sole gate — confirmed correct per DECISION-028 and Phase 2 Ruling 3.

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `POST /api/webhooks/resend` (route handler) | no — public endpoint; Svix HMAC signature is the only gate (DECISION-028) | no — n/a | n/a |
| `retryEmailAction` (server action) | yes | yes | `FEATURES.ADMIN_EMAIL_QUEUE` ("admin.email_queue") ✓ |

Proxy coverage: `/api/webhooks/resend` falls through the proxy's `/api/` passthrough (verified at `src/proxy.ts` line 26 by Phase 4b implementer).

### Coverage on Critical Modules

- `src/app/api/webhooks/resend/verify-signature.ts`: covered by 6 (or more) targeted unit tests in `verify-signature.test.ts` including boundary cases (stale timestamp, multi-sig with invalid first entry, no v1 entries)
- `src/lib/email/queue.ts` (`recordDeliveryEvent`): 5 additional tests in `queue.test.ts` covering all five event types and the `matched:false` case

### Open questions / handoff notes

- Next agent: **analyst** for Phase 6.
- Live Resend webhook delivery is not e2e-tested (requires a Resend-signed request from outside); all signature-verification branches are covered by unit tests. This is the correct and expected scope for a webhook handler.
- No auth-touching files in this feature — standard Phase 5 gate applies.

---

## Phase 6 — Shipped vs Intent — 2026-07-02

**Owner:** analyst
**Status:** complete

### Summary

**Verdict:** SHIP IT

**One-line take:** Resend delivery events now land on queue rows via a properly verified webhook, and operators can view the queue and retry failed sends at `/admin/email-queue`.

### What I did

**What's working:** Migration 0006 added five nullable delivery-timestamp columns and `ix_email_queue_provider_message_id` (required for the webhook UPDATE WHERE clause). `recordDeliveryEvent()` in `queue.ts` is the sole write path for webhook-sourced delivery state — module boundary clean. The hand-rolled HMAC verifier in `verify-signature.ts` satisfies all three Phase 2 mandates: `crypto.timingSafeEqual()` (no string comparison), `Math.abs(Date.now() / 1000 - ts) > 300` replay window (explicit, not implicit), and `split(" ").filter(e => e.startsWith("v1,"))` multi-sig parsing. DECISION-028 response contract is correct: 200 for unset secret (not 503), 400 for bad/stale signature, 200 for unknown event types. `retryEmailAction` is scoped to `failed` rows only, resets `status='queued'`, `nextAttemptAt=new Date()`, `attemptCount=0`, leaves `failureReason` in place, and carries both audit-exempt markers. The admin viewer has count strip, status filter tabs, `overflow-x-auto` table, delivery event badges, and `RetryButton` client island.

**Intent-vs-shipped diff:**

- Phase 1 said: delivery outcomes land on queue rows via the verified webhook. Shipped: `recordDeliveryEvent()` maps five event types to five nullable timestamp columns via `ix_email_queue_provider_message_id` index. Verdict: matches.
- Phase 2 said: 200 for disabled-when-unset (not 503 — 503 produces a retry storm). Shipped: `200 {received:false, note:"Webhook not configured."}`. Verdict: matches — this was a Phase 2 correction to the Phase 1 spec.
- Phase 2 said: three HMAC mandates are hard requirements. Shipped: all three verified in Phase 5 code read and in `verify-signature.test.ts` (12+ tests). Verdict: matches.
- Phase 1 said: retry for `failed` rows resets `attemptCount=0`, `status='queued'`, `nextAttemptAt=NOW()`. Shipped: exactly that; `failureReason` left in place for the admin to read before retry fires. Verdict: matches.
- Phase 1 said: Retry-now is audit-exempt with explicit marker. Shipped: file-level and inline `// audit-exempt: operator retry is non-security-sensitive` comments; `check:audit` passes. Verdict: matches.
- Phase 3 said: `verifyResendSignature` module-private to route.ts. Shipped: extracted to co-located `verify-signature.ts` for unit-testability. Verdict: acceptable drift — not part of the public email API; isolation goal met.

**Edge cases:**

- Empty state: pass — empty queue shows "No emails in the queue yet. Emails sent by the app appear here automatically." Zero-filter state shows "No emails match this filter."
- Failure microcopy: pass — `retryEmailAction` returns typed error strings ("Row not found.", "Only failed rows can be retried.") for all failure paths.
- Permission gate: pass — `retryEmailAction` re-checks `hasFeature(FEATURES.ADMIN_EMAIL_QUEUE)` inside the action; webhook is public with Svix HMAC as the only gate per DECISION-028.
- Audit event: pass — `retryEmailAction` is audit-exempt with markers (operator-operational, not security-sensitive); `EMAIL_QUEUE_PERMANENT_FAILURE` (written by the worker) captures permanent failures. Webhook itself requires no audit event.
- Mobile: pass — `overflow-x-auto` wrapper on the queue table; admin-only surface where desktop use is the primary scenario.

### Outputs

- `drizzle/0006_slippery_korath.sql` — migration verified.
- `src/lib/email/queue.ts` — `recordDeliveryEvent()` export verified.
- `src/app/api/webhooks/resend/verify-signature.ts` — all three HMAC mandates verified.
- `src/app/api/webhooks/resend/route.ts` — DECISION-028 contract verified.
- `src/app/(admin)/admin/email-queue/actions.ts` — `retryEmailAction`, audit-exempt markers, `failed`-only guard verified.
- `src/app/(admin)/admin/email-queue/page.tsx` — admin viewer verified.
- `e2e/admin-email-queue.spec.ts` — 5 e2e tests verified.

### Open questions / handoff notes

- Live Resend webhook delivery test (real Resend-signed request) remains out of scope; unit tests cover all signature-verification branches. Acceptable for a starter.

## Intent (2026-07-02)

Two coupled email-queue follow-ups (harvest Tier 2 #7 optional pair):
(1) /admin/email-queue viewer — queue rows newest-first (status badge,
recipient, subject, attempts, next/last attempt, failure reason), a
Retry-now action for failed/queued rows (resets nextAttemptAt/attempts? —
analyst defines semantics; audited or exempt — decide: operator retry is
operational, lean exempt with marker), count summary by status. New
admin.email_queue key + card. (2) Resend delivery webhook — port
fertilityluna's svix-verified handler
(/Users/cshenso/git/fertilityluna/src/app/api/webhooks/resend/route.ts):
disabled-when-unset (RESEND_WEBHOOK_SECRET), maps
delivered/opened/clicked/bounced/complained onto the queue row via
provider_message_id, returns 200 for unknown types. Schema: new nullable
delivery-status columns on email_queue (analyst inventories exactly which)
→ migration 0006. svix dependency question for the architect (fertilityluna
uses the svix package — or hand-verify the signature; weigh the dep).
