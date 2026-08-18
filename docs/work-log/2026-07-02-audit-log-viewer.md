# Audit log viewer at /admin/audit — Work Log

> **Slug:** `2026-07-02-audit-log-viewer`
> **Surface:** (admin)/admin/audit — new subpage
> **Permission(s):** new admin.audit FEATURES key expected
> **Flag(s):** not needed
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete | READY WITH NOTES | 2026-07-02 |
| 2 — Architectural review | architect | complete | Approved | 2026-07-02 |
| 3 — Technical design | tech-lead | complete | — | 2026-07-02 |
| 4 — Implementation | full-stack-developer | complete | — | 2026-07-02 |
| 5 — Verification | qa | complete | PASS | 2026-07-02 |
| 6 — Shipped vs intent | analyst | complete | SHIP IT | 2026-07-02 |

---

## Intent (2026-07-02)

Long-standing follow-up, now with real payoff: audit_events rows carry
ip/user_agent (recordAudit) and new signal classes (ACCESS_DENIED,
USER_ACCOUNT_LOCKED, EMAIL_QUEUE_PERMANENT_FAILURE). Build a read-only
viewer: newest-first table (action, actor, resource, ip, user-agent
truncated, FormattedDate), filter by action key (server-rendered select) and
actor email substring, pagination (limit/offset or cursor — analyst
weighs), count summary. New admin.audit permission + catalog + admin
dashboard card. Read-only: no mutations, no audit-of-viewing (decide:
viewing the audit log is itself security-relevant in some shops — take a
position; lean: no event for the starter, note for forks). XSS: plain JSX
text for all row content incl. metadata JSON (render as <pre> text).
Metadata display: compact JSON. PII: full emails visible to admins here?
(actor_email is stored — lean yes, admins are trusted; consistent with
the audit table's purpose).

---

## Phase 1 — Functional Refinement — 2026-07-02

**Owner:** analyst
**Status:** complete

### Summary

The audit log viewer is a read-only admin subpage at `/admin/audit` that surfaces the existing `audit_events` table — already populated by every security-sensitive mutation in the app. The feature is well-bounded: a server-rendered table with two GET-param filters (action key select, actor email substring), limit/offset pagination at 50 rows per page, and a count summary. No schema migration is needed — the existing `ix_audit_created` and `ix_audit_action_time` indexes cover the query patterns. The one architectural flag for Phase 2: the actor email substring filter (`ilike '%...%'`) will do a sequential scan; acceptable at starter scale but the architect should confirm. The no-audit-of-viewing and PII positions are both confirmed below.

### What I did

**Pass 1 — User verbs**

Surface: Admin (authenticated, has `admin.audit` permission).

- Admin navigates to `/admin/audit` (from admin sidebar link and dashboard card)
- Admin reads the table: action, actor email, resource type/ID, IP, user-agent (truncated), timestamp
- Admin selects an action key from the filter select dropdown
- Admin types an actor email substring in the filter text input
- Admin submits the filter form (GET request — page re-renders with filtered results)
- Admin clicks "Next" / "Previous" / a page number to page through results
- Admin reads the metadata block for a row (compact JSON in a `<pre>`)
- Admin clicks "Clear filters" to return to the unfiltered view

**Pass 2 — Flow audit**

Flow 1: Initial page load (no filters)

- Entry: Admin clicks "Audit Log" in the admin sidebar or dashboard card. URL: `/admin/audit`.
- Step 1: Server checks session → `hasFeature(FEATURES.ADMIN_AUDIT)` → renders page.
- Step 2: Query: `SELECT ... FROM audit_events ORDER BY created_at DESC LIMIT 50 OFFSET 0` + a COUNT query.
- Outcome: Table shows up to 50 rows newest-first. Header shows "Showing 1–50 of N events." Pagination controls appear if N > 50.
- Failure (empty table): Dashed-border empty state: "No audit events yet. Security-sensitive actions (sign-ins, role changes, 2FA) will appear here."

Flow 2: Filtered view

- Entry: Admin selects action from select and/or types email substring, submits form.
- Step 1: GET to `/admin/audit?action=user.role.assigned&actor=alice`.
- Step 2: Server validates action param against AUDIT_ACTIONS values (invalid value treated as no-filter). Runs filtered query + COUNT.
- Outcome: Table re-renders with matching rows. Header: "Showing 1–N of M matching events." "Clear filters" link appears.
- Failure (zero matching rows): "No events match these filters." with "Clear filters" link. Not the same copy as the zero-data empty state — a filter that yields nothing is different from a fresh install.

Flow 3: Pagination

- Entry: Admin is on page 1 of a multi-page result set.
- Step 1: Admin clicks "Next" or page 2. GET to `/admin/audit?page=2` (with any active filters preserved in the URL).
- Outcome: Page renders rows 51–100.
- Failure (page beyond last): Server clamps to the last valid page (does not redirect; renders last page with a note or simply renders the last page silently).

Flow 4: No permission

- Entry: Authenticated admin without `admin.audit` feature accesses `/admin/audit`.
- Outcome: Page renders the "You don't have permission to view this page." paragraph (consistent with feedback page pattern — not a redirect, not a 403 status).

**Pass 3 — Permissions and flags**

Permission: New `FEATURES.ADMIN_AUDIT` key (value: `"admin.audit"`), category `"admin"`. Added to `FEATURE_CATALOG` in `src/lib/permissions.ts`. Seeded to the `admin` role in `scripts/seed.ts`. No feature flag table entry — the page is either permissioned or not; no staged rollout needed.

Flag: none. The page is purely a data viewer; no in-progress logic requires flag gating.

**Pass 4 — Edge cases the request didn't address**

1. **Null actorEmail (system events).** `recordAudit({ actor: null, ... })` writes null to `actorEmail`. The viewer must handle this: render "System" or "—" for null. The ACCESS_DENIED event from `access-pending/page.tsx`, the RATE_LIMIT_BLOCKED event, and the EMAIL_QUEUE_PERMANENT_FAILURE event all use system or IP-keyed actors — these are real rows in the table. The viewer must not crash on null email.

2. **Null actorUserId (user deleted).** The `actorUserId` FK has `onDelete: "set null"` — rows survive user deletion. `actorEmail` remains (it is plain text, not a FK). The table should show the email with a visual indicator that the linked account no longer exists — or simply show the email as-is. Simplest: show the email as-is; the column header "Actor" is sufficient context.

3. **Empty metadata `{}`.** The default for `metadata` is `'{}'::jsonb`. Rendering `<pre>{}</pre>` for every row is visual noise. The viewer should suppress the metadata block when `metadata` is `{}` (or `Object.keys(metadata).length === 0`).

4. **Long user-agent strings.** User-agent strings can exceed 200 characters. Truncate at ~80 characters in the cell; expose the full value via the HTML `title` attribute. The intake says "user-agent truncated" in the column — this is the right call.

5. **Null IP.** System writes (seed, cron) have null IP. Render as "—".

6. **Null resourceType/resourceId.** Many audit events (e.g., `feature_flag.toggled`) populate resourceType; some (e.g., `rate_limit.blocked`) do not. Render "—" for nulls; do not show an empty cell.

7. **Mobile (360px).** The table has seven columns: action, actor, resource, IP, user-agent, date, and metadata. Seven columns at 360px will overflow. The `overflow-x-auto` wrapper (used in the feedback page) is required. The metadata column could be deprioritized (hidden on mobile, accessible via an expand action).

8. **Actor email substring search with SQL wildcards.** A user typing `%` or `_` in the actor filter will be interpreted as SQL wildcards by a `LIKE` operator — this is expected and harmless (it just broadens the search). No sanitization needed; parameterized queries prevent injection.

9. **Filter action param validation.** An attacker crafting a request with `?action=arbitrary_value` will get zero rows (the WHERE clause finds nothing) — no data leak. But the server should still validate: if the value is not in the AUDIT_ACTIONS catalog, treat it as no-filter and silently clear it (or show a warning). The select dropdown makes this unlikely in normal use but the server must not trust it.

10. **Count query performance.** Each page load runs two queries: the paged SELECT and a COUNT(*) with the same WHERE clause. On a large audit table (>100k rows), COUNT(*) can be slow without the right index. The `ix_audit_created` index on `createdAt` will not help a filtered COUNT. For the starter this is acceptable — audit tables at starter scale (first year: typically <50k rows) are not a performance concern. Flag for the architect as a known limitation.

**Pass 5 — Adversarial pass**

- **Redirect parameters.** No redirect parameters on this page. The only URL params are `action`, `actor`, `page` — all read-only filter/pagination inputs with no redirect behavior.
- **State-machine shortcuts.** The page is read-only with no state transitions. There is nothing to skip.
- **Enumeration leaks.** The page is behind the `admin.audit` permission gate. An unauthenticated user or an authenticated user without the permission gets the "no permission" paragraph and sees nothing. The underlying query never runs. No data is leaked to unpermissioned requests.
- **Input boundaries.** `actor` filter: an overlong string (e.g., 10,000 chars) is passed to `ilike`. The database handles it; no server crash. The server should apply a reasonable max-length limit (256 chars) before passing to the query. The `action` filter is validated against a fixed catalog. `page` must be parsed as a positive integer and clamped.
- **Self-targeting.** Read-only page; no mutations. No self-targeting concern.
- **XSS via metadata.** The `metadata` jsonb column is written by server-side code only (all writes go through `recordAudit()`). Content in metadata is never user-supplied HTML — it is structured data like `{ email, via, reason }`. Rendering as a JSX text node inside `<pre>` is XSS-safe regardless.

### Outputs

Index/migration ruling: **no new indexes needed for MVP.** The schema already defines:
- `ix_audit_created` ON (createdAt) — covers unfiltered `ORDER BY created_at DESC` pagination
- `ix_audit_action_time` ON (action, createdAt) — covers `WHERE action = $1 ORDER BY created_at DESC` (action filter path)
- `ix_audit_actor` ON (actorUserId) — not used by this viewer

The actor email substring filter (`actorEmail ilike '%...%'`) has **no suitable index** and will scan. This is acceptable at starter scale and expected for leading-wildcard `ilike`. Flag to architect: if forks expect high-volume audit tables, a `pg_trgm` GIN index on `actorEmail` would help, but this is deferred and not recommended for the starter.

No migration needed unless the architect disagrees. The existing schema is sufficient.

Files to be created/modified (by implementer, not by analyst):
- `src/lib/permissions.ts` — add `ADMIN_AUDIT: "admin.audit"` to FEATURE_CATALOG
- `scripts/seed.ts` — bind `admin.audit` to the admin role
- `src/app/(admin)/admin/audit/page.tsx` — new Server Component: filter form, table, pagination, empty state
- `src/app/(admin)/admin/` (layout or sidebar) — add "Audit Log" nav link
- `src/app/(admin)/admin/page.tsx` — add Audit Log dashboard card

### Open questions / handoff notes

- **Architect:** Confirm the `actorEmail ilike` scan is acceptable for the starter. If not, propose the GIN index and migration number (0006 would be next).
- **Architect:** Confirm the page is a pure Server Component — no client islands needed. The filter form is a GET form (no JS); pagination is GET links. The only potential client island is the metadata expand/collapse on mobile, which could be a `<details>` HTML element (no JS required). Confirm.
- **Tech-lead:** The action select should be populated from the AUDIT_ACTIONS catalog (26 values). Group by prefix for readability (user.*, totp.*, feature_flag.*, rate_limit.*, email.*, access.*) — confirm grouping approach or flat list.
- **Tech-lead:** Confirm the "no audit-of-viewing" position for the starter and add a fork note to the Phase 3 design doc for shops that need SOC 2 / HIPAA audit of viewer access.
- **Tech-lead:** Confirm metadata empty-state treatment: suppress `<pre>` block when `metadata` is `{}`.
- **Tech-lead:** Confirm page size of 50 rows, and whether to show a "total" count or just prev/next with "showing X–Y of N."

---

## Phase 2 — Architectural Review — 2026-07-02

**Owner:** architect
**Status:** complete

### Summary

Approved. The feature is a clean fit for the starter's architecture: a pure Server Component page under `(admin)/admin/`, no new schema, no new migrations, one new FEATURES key, and a nav link added to the admin layout's static array. All six analyst rulings are confirmed or endorsed. The actor-email substring scan is acceptable at starter scale; the no-migration ruling is verified against schema.ts. No new dependencies.

### What I did

**Ruling 1 — Directory placement and no actions.ts**

`src/app/(admin)/admin/audit/page.tsx` is correct per the route group rules. Admin subpages live under `(admin)/admin/`. The page is read-only — it executes only SELECT queries and produces no mutations. There is no `actions.ts` because there are no mutations. This means the `check:audit` script (`npm run check:audit`) does not scan this directory, and the "every actions.ts must reference an AUDIT_ACTIONS key" invariant does not apply. Confirmed zero check:audit surface.

**Ruling 2 — No-migration confirmed**

Verified against `src/lib/db/schema.ts` (lines 213-217):

```typescript
index("ix_audit_actor").on(t.actorUserId),       // line 214
index("ix_audit_action_time").on(t.action, t.createdAt), // line 215
index("ix_audit_created").on(t.createdAt),        // line 216
```

All three indexes the analyst cited exist in the schema. No new migration is needed. The query patterns the viewer requires are covered:
- Unfiltered `ORDER BY created_at DESC` → `ix_audit_created` (index scan, backward)
- `WHERE action = $1 ORDER BY created_at DESC` → `ix_audit_action_time` (composite covers both filter and sort)
- `actorEmail ilike '%...%'` → **no suitable index; sequential scan**

The actor email substring scan with a leading wildcard cannot use any B-tree index. At starter scale (< 50k rows in a first-year deployment), a sequential scan over `audit_events` is acceptable — the table is narrow and append-only, so Postgres heap scans are fast. A `pg_trgm` GIN index on `actorEmail` would eliminate the scan for forks with high-volume audit tables. This is explicitly deferred: no migration number reserved, no schema touch in this feature. The Phase 3 design doc should document this as a "fork-scaling note" in a code comment at the query site, so fork developers know where to add the GIN index if they need it.

**Ruling 3 — Limit/offset + GET-param filters**

Endorsed. Limit/offset is correct for this use case:
- The data is append-only and time-ordered — no rows disappear between paginated requests, so offset drift is not a concern in practice.
- GET params are bookmarkable, shareable, and compatible with a fully server-rendered page (no client state required).
- Cursor-based pagination would provide no practical benefit and would require a more complex query shape.

**Validation posture confirmed:** The `action` param must be validated against `AUDIT_ACTIONS` values before use in a WHERE clause. Invalid values (not in the catalog) → treat as no-filter (silently drop). This is defense-in-depth: parameterized queries prevent injection, but catalog validation prevents an attacker from inferring table contents via timing differences on exotic filter values. The `page` param must be parsed as a positive integer and clamped to `[1, lastPage]`. The `actor` param should be max-length clamped at 256 chars before being passed to `ilike`.

**Ruling 4 — admin.audit key, dashboard card, and sidebar nav**

Permission key: `ADMIN_AUDIT: "admin.audit"` added to `FEATURE_CATALOG` in `src/lib/permissions.ts` and `FEATURES`. Category `"admin"`. Seeded to the `admin` role in `scripts/seed.ts`. Confirmed correct shape — this follows the exact same pattern as every other admin feature key in the catalog.

Admin nav: the nav array lives in `src/app/(admin)/admin/layout.tsx` lines 17-23 as a plain JavaScript array. The implementer adds `{ href: "/admin/audit", label: "Audit Log" }` to this array. No layout abstraction, no dynamic nav generation — the static array is the established pattern for this starter and matches the 5 existing entries.

Dashboard card: new card in `src/app/(admin)/admin/page.tsx`. The page currently has cards for Users, Feature flags, Release notes, and 2FA. Audit Log is a natural sixth card. The implementer reads the page and matches the existing card component shape.

**Ruling 5 — No audit of viewing**

Endorsed for the starter. The audit log's purpose is to record security-sensitive mutations (role changes, flag toggles, TOTP enrolment, deactivations). Viewing the audit log is a read; reads are not audited. This is consistent with the starter's `AUDIT_ACTIONS` catalog, which contains only mutation event keys.

Fork note (for Phase 3 design doc): SOC 2 Type II and HIPAA environments commonly require audit-of-audit-viewer access — if an auditor can read and potentially cover tracks, that read must itself be logged. Forks targeting those compliance regimes should add `ADMIN_AUDIT_VIEWED: "admin.audit.viewed"` to `AUDIT_ACTIONS` and call `recordAudit(...)` at the top of the page's data-loading code. This is a one-function call; the schema already supports it.

**Ruling 6 — `<pre>` JSON metadata XSS posture**

Confirmed safe. The `metadata` column is `jsonb`, written exclusively by server-side calls to `recordAudit()`. Content is structured data authored in code (e.g., `{ email, via, reason }`, `{ key, previousValue, newValue }`, `{ ip, email }`) — never user-supplied HTML or markup. Drizzle deserializes it to a JavaScript object when reading. Rendering as `<pre>{JSON.stringify(row.metadata, null, 2)}</pre>` is safe: React's JSX text interpolation treats the string as text, not HTML — no dangerouslySetInnerHTML, no XSS surface. Suppress the `<pre>` block entirely when `Object.keys(row.metadata).length === 0` (the `'{}'::jsonb` default) to avoid visual noise.

**Server vs. client boundary**

The page is a pure Server Component. The filter form is a standard HTML GET form (no `onSubmit`, no JS required). Pagination is anchor links with GET params. The metadata expand/collapse on mobile can be implemented with the native `<details>`/`<summary>` HTML elements — no JavaScript, no `'use client'`, no client island needed. Confirmed: zero `'use client'` components required for MVP.

### Outputs

- Files touched by this phase: none (read-only review).
- No new DECISION entry. All rulings fit within existing conventions (DECISION-003 for the permissions/flags split, DECISION-021 for directory placement).

### Open questions / handoff notes

- **Tech-lead (Phase 3):** Document the GIN index fork-scaling note at the query site (the `actorEmail ilike` query in the page's data-loading function). One comment is sufficient — no schema change for the starter.
- **Tech-lead (Phase 3):** Confirm grouping approach for the action select (grouped by prefix vs. flat alphabetical). Either is architecturally neutral; the decision belongs in Phase 3 as a UX choice.
- **Tech-lead (Phase 3):** Confirm no-audit-of-viewing position and add the SOC 2/HIPAA fork note to the design doc.
- **Implementer (Phase 4 — ux-developer or full-stack-developer):** The nav array addition (`src/app/(admin)/admin/layout.tsx`) and the dashboard card (`src/app/(admin)/admin/page.tsx`) are straightforward additions. Read the existing entries and match the shape exactly.
- **Implementer (Phase 4):** Apply the three input guards before constructing queries: (a) validate `action` against `AUDIT_ACTIONS` keys, (b) clamp `page` to a positive integer, (c) truncate `actor` to 256 chars. These are the only server-trust-boundary validations needed for a read-only page.

---

## Phase 3 — Technical Design — 2026-07-02

**Owner:** tech-lead
**Status:** complete

### Summary

The audit log viewer is a pure Server Component page at `/admin/audit` that surfaces the existing `audit_events` table for admins. No schema changes, no new migrations, no server actions. The page renders a GET-param filter form (action select + actor email substring), a paginated table at 50 rows/page with `<FormattedDate>`, `<details>` metadata expand, and proper null handling ("—" for all nullable fields). A new `ADMIN_AUDIT` permission key is added to `FEATURES` and `FEATURE_CATALOG`; `bindAdminFeatures()` in `seed.ts` auto-binds it to the admin role without any seed.ts modification. The proxy's `/^\/admin/` catch-all already covers `/admin/audit`; no new PROTECTION_RULES entry is needed. The page does its own `hasFeature(ADMIN_AUDIT)` inline-403 check per the feedback page precedent.

### Permissions & Flags

- Permission key(s): `ADMIN_AUDIT: "admin.audit"` — added to `FEATURES` and `FEATURE_CATALOG` in `src/lib/permissions.ts`.
- Default role binding: `admin` — via existing `bindAdminFeatures()` in `scripts/seed.ts` (iterates `Object.values(FEATURES)`; no seed.ts edit needed).
- Feature flag(s): not needed. The page is purely permission-gated; no staged rollout.

### API Contract

No new API routes or server actions. All data access is in the RSC page body via Drizzle queries (read-only `SELECT`).

### Data Model

No schema changes required. Existing indexes verified:
- `ix_audit_created` ON (`createdAt`) — covers unfiltered `ORDER BY created_at DESC`
- `ix_audit_action_time` ON (`action`, `createdAt`) — covers `WHERE action = $1 ORDER BY created_at DESC`
- `actorEmail ilike '%...%'` — sequential scan (no suitable B-tree index for leading wildcard); acceptable at starter scale

### Component / Page Plan

**Files to create:**

- `src/app/(admin)/admin/audit/page.tsx` — new RSC page

**Files to modify:**

- `src/lib/permissions.ts` — add `ADMIN_AUDIT` to `FEATURES` and `FEATURE_CATALOG`
- `src/app/(admin)/admin/layout.tsx` — add `{ href: "/admin/audit", label: "Audit Log" }` to the `nav` array (after "Release notes" entry, before "Your 2FA")
- `src/app/(admin)/admin/page.tsx` — add Audit Log card to the `cards` array

**Files NOT modified:**

- `scripts/seed.ts` — `bindAdminFeatures()` already iterates `Object.values(FEATURES)`, so adding `ADMIN_AUDIT` to `FEATURES` is sufficient
- `src/proxy.ts` — `/admin/audit` inherits the `/^\/admin/` catch-all rule (`FEATURES.ADMIN_DASHBOARD`); no new PROTECTION_RULES entry needed. The page adds its own `hasFeature(ADMIN_AUDIT)` inline-403 gate.

---

### Detailed Specifications

#### 1. `src/lib/permissions.ts` — `ADMIN_AUDIT` addition

```typescript
export const FEATURES = {
  ADMIN_DASHBOARD: "admin.dashboard",
  ADMIN_USERS: "admin.users",
  ADMIN_FLAGS: "admin.flags",
  ADMIN_RELEASE_NOTES: "admin.release_notes",
  ADMIN_FEEDBACK: "admin.feedback",
  ADMIN_AUDIT: "admin.audit",               // NEW
} as const;
```

Add to `FEATURE_CATALOG`:
```typescript
{
  key: FEATURES.ADMIN_AUDIT,
  name: "View audit log",
  description: "Read the security audit log at /admin/audit.",
  category: "admin",
},
```

#### 2. `src/app/(admin)/admin/audit/page.tsx`

Pure Server Component. No `'use client'`, no `actions.ts`, no mutations.

```
// SOC 2 / HIPAA fork note: viewing the audit log is not itself audited in the starter.
// Environments requiring audit-of-audit-viewer access should add ADMIN_AUDIT_VIEWED to
// AUDIT_ACTIONS and call recordAudit({ action: AUDIT_ACTIONS.ADMIN_AUDIT_VIEWED, ... })
// at the top of this page's data-loading block.
```

**searchParams type:**
```typescript
{ searchParams: Promise<{ action?: string; actor?: string; page?: string }> }
```

**Input guards (three, applied before any query construction):**

1. `validAction`: Validate `sp.action` against `Object.values(AUDIT_ACTIONS)`. If not in catalog → `undefined` (no-filter). Type: `AuditAction | undefined`.
   ```typescript
   const validAction =
     sp.action && (Object.values(AUDIT_ACTIONS) as string[]).includes(sp.action)
       ? (sp.action as AuditAction)
       : undefined;
   ```

2. `validActor`: Clamp `sp.actor` to 256 chars. Empty string → `undefined`.
   ```typescript
   const validActor = sp.actor?.slice(0, 256).trim() || undefined;
   ```

3. `page`: Parse as positive integer; clamp to `[1, ∞)`.
   ```typescript
   const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
   const limit = 50;
   const offset = (page - 1) * limit;
   ```

**Query construction:**

```typescript
// Build where conditions
const conditions: SQL[] = [];
if (validAction) conditions.push(eq(auditEvents.action, validAction));
// Fork-scaling note: the actorEmail ilike filter uses a sequential scan with a
// leading wildcard — no B-tree index can accelerate it. At starter scale (<50k rows)
// this is acceptable. For high-volume audit tables, add a GIN index:
//   CREATE INDEX ON audit_events USING gin(actor_email gin_trgm_ops);
// (requires pg_trgm extension). See 2026-07-02-audit-log-viewer Phase 2 for details.
if (validActor) conditions.push(ilike(auditEvents.actorEmail, `%${validActor}%`));

const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

const [rows, countResult] = await Promise.all([
  db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      actorEmail: auditEvents.actorEmail,
      resourceType: auditEvents.resourceType,
      resourceId: auditEvents.resourceId,
      ip: auditEvents.ip,
      userAgent: auditEvents.userAgent,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(whereClause)
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit)
    .offset(offset),
  db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(whereClause),
]);

const totalCount = countResult[0]?.count ?? 0;
const totalPages = Math.max(1, Math.ceil(totalCount / limit));
const clampedPage = Math.min(page, totalPages);
// Re-query if page was out of bounds (user crafted a URL with page=99999).
// Simpler: just use clampedPage for display without re-querying; show last page's data.
```

**Permission gate (identical to feedback page pattern):**

```typescript
const session = await auth();
if (!session?.user) redirect("/signin?callbackUrl=/admin/audit");
if (!hasFeature(session.user.features, FEATURES.ADMIN_AUDIT)) {
  return (
    <p className="text-sm text-muted-foreground">
      You don&apos;t have permission to view this page.
    </p>
  );
}
```

**Filter form:**

Standard HTML GET form (`method="get"` is the default for `<form>` without `action="javascript:"`). No `action` attribute — submits to current path.

Action select uses grouped `<optgroup>` by prefix for readability at 26 items. The grouping matches the AUDIT_ACTIONS key prefixes:

| Group label | AUDIT_ACTIONS prefix | Count |
|------------|---------------------|-------|
| Access | `access.*` | 1 |
| Email | `email.*` | 1 |
| Feature flags | `feature_flag.*` | 1 |
| Rate limiting | `rate_limit.*` | 1 |
| TOTP | `totp.*` | 8 |
| User | `user.*` | 14 |

Within each group, options are sorted alphabetically by value string. The implementer should build this by filtering `Object.values(AUDIT_ACTIONS)` by prefix at render time — no hardcoded list.

"All actions" `<option value="">All actions</option>` at the top (selected when `validAction` is undefined).

The actor input is a plain text `<input name="actor" type="text" />` with `maxLength={256}` (matches server-side clamp). `defaultValue={validActor ?? ""}`.

A "Clear filters" link appears only when at least one filter is active: `<a href="/admin/audit">Clear filters</a>`.

Submit button: `<button type="submit">Apply filters</button>`.

**Table columns:**

| Column | Source | Null handling | Notes |
|--------|--------|--------------|-------|
| Date | `createdAt` | Never null | `<FormattedDate value={row.createdAt} mode="datetime" />` |
| Action | `action` | Never null | Plain text |
| Actor | `actorEmail` | `null` → "—" | Full email; admins are trusted (Phase 1 PII ruling) |
| Resource | `resourceType` + `resourceId` | Either null → "—" | Render as `type/id`; if only one present render what's available |
| IP | `ip` | `null` → "—" | Plain text |
| User-agent | `userAgent` | `null` → "—" | Truncate display: use CSS `className="max-w-[200px] truncate"` + `title={row.userAgent}` for full value on hover |
| Metadata | `metadata` | `{}` → suppress | See below |

**Metadata rendering:**

```tsx
{Object.keys(row.metadata ?? {}).length > 0 && (
  <details>
    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
      View metadata
    </summary>
    <pre className="mt-1 overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
      {JSON.stringify(row.metadata, null, 2)}
    </pre>
  </details>
)}
```

Safe: `metadata` is `jsonb` written only by server-side `recordAudit()`. Drizzle deserializes to a JS object. React text interpolation in `<pre>` is not HTML. No `dangerouslySetInnerHTML`.

**Table wrapper:** `<div className="overflow-x-auto">` (same as feedback page).

**Count summary header:**

- Filtered: `Showing {offset + 1}–{offset + rows.length} of {totalCount} matching events.`
- Unfiltered: `Showing {offset + 1}–{offset + rows.length} of {totalCount} events.`
- When `rows.length === 0`: suppress the range display.

**Pagination links:**

Preserve filter params in pagination URLs. Build a helper:
```typescript
function buildPageUrl(p: number) {
  const params = new URLSearchParams();
  if (validAction) params.set("action", validAction);
  if (validActor) params.set("actor", validActor);
  params.set("page", String(p));
  return `/admin/audit?${params.toString()}`;
}
```

Render: Previous link (hidden when `page === 1`) | page indicator `Page {page} of {totalPages}` | Next link (hidden when `offset + rows.length >= totalCount`).

**Empty states (two variants):**

Zero-data (no filters active, `totalCount === 0`):
```tsx
<div className="rounded-lg border border-dashed border-border py-16 text-center">
  <p className="text-sm font-medium">No audit events yet</p>
  <p className="mt-1 text-sm text-muted-foreground">
    Security-sensitive actions (sign-ins, role changes, 2FA) will appear here.
  </p>
</div>
```

Zero-filter (filters active, `rows.length === 0`):
```tsx
<div className="rounded-lg border border-dashed border-border py-16 text-center">
  <p className="text-sm font-medium">No events match these filters</p>
  <a href="/admin/audit" className="mt-2 block text-sm text-muted-foreground underline-offset-4 hover:underline">
    Clear filters
  </a>
</div>
```

#### 3. `src/app/(admin)/admin/layout.tsx` — nav addition

Add to the `nav` array after `{ href: "/admin/docs", label: "Release notes" }` and before `{ href: "/admin/2fa", label: "Your 2FA" }`:

```typescript
{ href: "/admin/audit", label: "Audit Log" },
```

#### 4. `src/app/(admin)/admin/page.tsx` — dashboard card addition

Add to the `cards` array (after "Feedback" and before "Your 2FA" is a natural position):

```typescript
{
  href: "/admin/audit",
  title: "Audit log",
  blurb: "Security events, sign-ins, and flag changes.",
},
```

The cards array then has 6 entries. The existing `grid-cols-2` renders them as 3×2. No layout change needed.

### Implementation Order

1. `src/lib/permissions.ts` — add `ADMIN_AUDIT` to `FEATURES` and `FEATURE_CATALOG` (required by page; trivial)
2. `src/app/(admin)/admin/audit/page.tsx` — RSC page (main work)
3. `src/app/(admin)/admin/layout.tsx` — nav entry
4. `src/app/(admin)/admin/page.tsx` — dashboard card
5. Verify: `npm run typecheck` + `npm run test` + `npm run test:e2e`

### Edge Cases & Risks

- **`auditEvents.metadata` Drizzle typing:** Drizzle infers `jsonb` columns as `unknown`. The page casts via `row.metadata as Record<string, unknown>` (or the schema column type if it's been typed). `Object.keys()` on `unknown` requires the cast. Verify the Drizzle schema type for `metadata` before writing the `Object.keys()` guard.

- **`ilike` with Drizzle:** Drizzle's `ilike` function is imported from `drizzle-orm`. Confirm the import is `import { ilike } from "drizzle-orm"` — not from `drizzle-orm/pg-core`. The `and()`, `eq()`, `desc()`, `sql` operators are also from `drizzle-orm`.

- **`count(*)::int` cast:** `sql<number>\`count(*)::int\`` tells Drizzle to type the result as `number`. Without `::int`, Drizzle returns the count as a string (PostgreSQL `bigint` serialized as string). The cast is required.

- **Page number out of bounds:** A URL with `page=9999` on a 50-row table yields `offset=499950`, which returns 0 rows. The empty-filter state would show if filters are active, or the zero-data state otherwise. This is acceptable — no re-query or redirect needed. The count summary shows "Showing 499951–499950 of 50 events" which looks wrong. Clamp the display: `const displayOffset = Math.min(offset, Math.max(0, totalCount - 1))` for the "Showing X–Y" line.

- **`<details>` in table cell:** The `<details>` element is a block element. Inside a `<td>` this works correctly in modern browsers but may cause minor height inconsistency in table rows when open. Use `<details className="mt-1">` on the cell's content wrapper, not on the cell itself.

### Tests

**Unit tests — extracted input guard helpers:**

The three input guards (action validation, page clamping, actor truncation) are pure functions — extract them from the page into testable helpers. Either co-locate in the page file (exported) or put in `src/lib/audit-page-helpers.ts`.

| Test | Input | Expected |
|------|-------|----------|
| `validateAuditAction(undefined)` | — | `undefined` |
| `validateAuditAction("feature_flag.toggled")` | valid key | `"feature_flag.toggled"` |
| `validateAuditAction("injected.value")` | not in catalog | `undefined` |
| `validateAuditAction("")` | empty | `undefined` |
| `clampPage(undefined)` | — | `1` |
| `clampPage("abc")` | not a number | `1` |
| `clampPage("-5")` | negative | `1` |
| `clampPage("0")` | zero | `1` |
| `clampPage("3")` | valid | `3` |
| `truncateActor(undefined)` | — | `undefined` |
| `truncateActor("")` | empty | `undefined` |
| `truncateActor("x".repeat(300))` | overlength | `"x".repeat(256)` |
| `truncateActor("alice@example.com")` | normal | `"alice@example.com"` |

**E2e tests:**

Add a new spec `e2e/admin-audit.spec.ts` (or extend `role-boundaries.spec.ts` if admin audit fits its pattern):

1. **Admin sees the audit table:** Authenticate as the seeded admin user. Navigate to `/admin/audit`. Assert the page renders without error (e.g., `<h1>` present or table header row visible). Assert the "Audit Log" nav link is present in the sidebar.

2. **Member is denied:** Authenticate as the seeded member user. Navigate to `/admin/audit`. Assert the page renders the inline-403 paragraph: `"You don't have permission to view this page."` (the inline-403 pattern from the feedback page). No redirect to `access-pending` — the proxy passes the member through with `ADMIN_DASHBOARD` gate, and the page itself shows the 403 paragraph.

3. **Filter smoke (optional stretch):** Navigate to `/admin/audit?action=feature_flag.toggled`. Assert no server error and that the page renders (may have 0 rows if the table is empty in the test environment — that's fine; the zero-filter empty state should appear, not a 500).

### Outputs

- New files: `src/app/(admin)/admin/audit/page.tsx`, `e2e/admin-audit.spec.ts`
- Modified files: `src/lib/permissions.ts`, `src/app/(admin)/admin/layout.tsx`, `src/app/(admin)/admin/page.tsx`
- Decisions: no new DECISION entry. All rulings fit within DECISION-003 (permissions/flags split) and DECISION-021 (directory placement).

### Open questions / handoff notes

- Implementer: **full-stack-developer** — pure RSC with no server/client split needed; the whole feature is tightly coupled data + UI with no actions.ts.
- The `metadata` column Drizzle type may need a cast. Check `auditEvents.metadata` in `src/lib/db/schema.ts` — if typed as `unknown`, cast to `Record<string, unknown>` in the page before calling `Object.keys()`.
- The input guard helpers should be exported so the Vitest unit tests can import them directly. Either export from the page file or extract to `src/lib/audit-page-helpers.ts` — the latter is preferable so the page stays clean.
- No seed.ts change is needed — verified that `bindAdminFeatures()` iterates `Object.values(FEATURES)`, so adding `ADMIN_AUDIT` to the `FEATURES` object is the only change required for the permission to bind to the admin role on next `npm run db:seed`.

---

## Phase 4 — Implementation (full-stack) — 2026-07-02

**Owner:** full-stack-developer
**Status:** complete

### Summary

Implemented the read-only audit log viewer at `/admin/audit` as a pure Server Component with no actions.ts, no client islands, and no schema changes. Added `ADMIN_AUDIT: "admin.audit"` to permissions, extracted three input-guard helpers into `src/lib/audit-page-helpers.ts` with 13 unit tests, built the RSC page with parallel Drizzle queries, grouped `<optgroup>` action select, `<details>/<pre>` metadata display, and two distinct empty states. Nav entry and dashboard card added. All verifications pass; `npm run db:seed` was run once to bind the new feature.

### What I did

- Added `ADMIN_AUDIT: "admin.audit"` to `FEATURES` and a matching `FEATURE_CATALOG` entry in `src/lib/permissions.ts`.
- Created `src/lib/audit-page-helpers.ts` with three exported pure functions: `validateAuditAction`, `clampPage`, `truncateActor`.
- Created `src/lib/audit-page-helpers.test.ts` with 13 unit tests covering all cases from the Phase 3 spec table (all pass).
- Created `src/app/(admin)/admin/audit/page.tsx` — pure RSC, inline auth + `hasFeature(ADMIN_AUDIT)` gate per feedback-page precedent, parallel Drizzle queries (50-row page + COUNT), `<optgroup>` action select grouped by prefix, `<details>/<pre>` metadata (suppressed when `{}`), null-safe "—" rendering for actorEmail/ip/userAgent/resource, GET-form filters, `buildPageUrl` prev/next pagination, two empty-state variants (zero-data / zero-filter), fork-scaling and SOC 2 comments at the relevant sites.
- Added `{ href: "/admin/audit", label: "Audit Log" }` to the `nav` array in `src/app/(admin)/admin/layout.tsx` (between "Release notes" and "Your 2FA").
- Added audit log card to the `cards` array in `src/app/(admin)/admin/page.tsx` (between "Feedback" and "Your 2FA").
- Confirmed `src/proxy.ts` requires no changes — `/admin/audit` inherits the `/^\/admin/` catch-all (`FEATURES.ADMIN_DASHBOARD`); the page adds its own `hasFeature(ADMIN_AUDIT)` inline-403 gate as the secondary check.
- Ran `npm run db:seed` to bind `admin.audit` to the admin role (seed output confirmed "seeded 6 features").
- Created `e2e/admin-audit.spec.ts` with 4 tests: admin sees heading, admin sees nav link, member is bounced to `/access-pending` (proxy gate), and filter-URL smoke. All 4 pass.

### Outputs

- **`src/lib/permissions.ts`** — `ADMIN_AUDIT: "admin.audit"` added to `FEATURES` and `FEATURE_CATALOG`.
- **`src/lib/audit-page-helpers.ts`** — new file; exports `validateAuditAction`, `clampPage`, `truncateActor`.
- **`src/lib/audit-page-helpers.test.ts`** — new file; 13 unit tests, all passing.
- **`src/app/(admin)/admin/audit/page.tsx`** — new Server Component page; auth gate (`redirect` if unauthenticated) + feature gate (inline-403 if no `admin.audit`); no mutations, no audit-of-viewing.
- **`src/app/(admin)/admin/layout.tsx`** — nav entry added.
- **`src/app/(admin)/admin/page.tsx`** — sixth dashboard card added.
- **`e2e/admin-audit.spec.ts`** — new spec; 4 tests, all passing (verified against live dev server).
- **Seed run:** `npm run db:seed` — now reports "seeded 6 features"; `admin.audit` bound to the admin role via `bindAdminFeatures()`.
- **Proxy ruling:** `proxy.ts` NOT modified. `/admin/audit` is covered by the existing `/^\/admin/` PROTECTION_RULES entry (requires `FEATURES.ADMIN_DASHBOARD`). The page adds `hasFeature(ADMIN_AUDIT)` as a secondary inline gate per the feedback-page pattern. No new PROTECTION_RULES entry needed or added.

### Open questions / handoff notes

- **qa (Phase 5):** Run `npm run typecheck` (passes), `npm run test` (352/352 pass including 13 new helpers cases), `npm run check:audit` (passes — no actions.ts in this feature). E2e: 4/4 pass against the dev server with the seeded admin user. The storageState cache must be current (was re-generated during Phase 4 verification after `npm run db:seed` was run).
- **Note for qa:** The inline-403 paragraph ("You don't have permission to view this page.") is exercised by the page's `hasFeature(ADMIN_AUDIT)` check. The e2e suite only tests the proxy bounce for the seeded member (who lacks `admin.dashboard`). To test the inline-403 path, a partial-admin user with `admin.dashboard` but without `admin.audit` is needed — no such user is seeded in the starter. This is a known gap documented in the e2e spec comment.
- **metadata Drizzle typing:** Confirmed `jsonb` columns type as `unknown` in Drizzle. Cast applied: `row.metadata as Record<string, unknown> | null` before `Object.keys()` and `JSON.stringify()`. TypeScript is happy (`npm run typecheck` clean).
- **Next agent:** qa for Phase 5 verification.

---

## Phase 5 — Verification — 2026-07-02

**Owner:** qa
**Status:** complete

### Summary

PASS. All shared checks passed (typecheck clean, lint clean, 408/408 unit tests, check:audit, check:sql-date, e2e 48/48). Per the Phase 4 implementer's note, the inline-403 path (a partial-admin with `admin.dashboard` but without `admin.audit`) is not covered by the seeded e2e users — this known gap is documented in the e2e spec comment and is acceptable at starter scale. All input guard helpers, the parallel query pattern, metadata suppression, and nav/card additions verified by code read.

### What I did

- Ran shared checks (once for all nine pipelines): `npm run typecheck` (clean), `npm run lint` (clean), `npm run test` (408/408 pass — includes 13 new audit-page-helpers tests), `npm run check:audit` (pass — no actions.ts in this feature), `npm run check:sql-date` (pass), `npm run test:e2e` (48/48 pass including 4 new admin-audit tests in `e2e/admin-audit.spec.ts`).
- Read `src/lib/audit-page-helpers.ts`: confirmed `validateAuditAction`, `clampPage`, `truncateActor` exported pure functions; validated action guard uses `Object.values(AUDIT_ACTIONS)` catalog check.
- Read `src/lib/audit-page-helpers.test.ts`: 13 unit tests covering all Phase 3 spec table cases including empty/undefined inputs, invalid catalog entries, negative/zero page values, and overlength actor strings.
- Read `src/app/(admin)/admin/audit/page.tsx`: confirmed `const session = await auth()` → `redirect("/signin?callbackUrl=/admin/audit")` if no session; `hasFeature(session.user.features, FEATURES.ADMIN_AUDIT)` inline-403 gate (returns `<p>You don't have permission...</p>` without redirect); parallel Drizzle queries via `Promise.all([ rows query, count query ])`; `{Object.keys(row.metadata ?? {}).length > 0 && <details>...</details>}` metadata suppression; SOC 2/HIPAA fork note comment present.
- Read `src/app/(admin)/admin/layout.tsx`: confirmed `{ href: "/admin/audit", label: "Audit Log" }` nav entry present.
- Read `src/app/(admin)/admin/page.tsx`: confirmed Audit Log dashboard card present in cards array.
- Confirmed `check:audit` correctly passes — no `actions.ts` in this feature (read-only page); the tripwire does not scan route handlers.

### Outputs

- No new files created. All checks ran against existing implementation.
- Known gap documented: inline-403 path (partial-admin with `admin.dashboard` but not `admin.audit`) requires a seeded user not present in the starter. Noted in `e2e/admin-audit.spec.ts` comment by Phase 4 implementer; acceptable.

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| GET `/admin/audit` (RSC page) | yes — `redirect("/signin?callbackUrl=/admin/audit")` if no session | yes — inline-403 paragraph | `FEATURES.ADMIN_AUDIT` ("admin.audit") ✓ |

No server actions in this feature (read-only page).

### Coverage on Critical Modules

- `src/lib/audit-page-helpers.ts`: 100% (13 tests, all branches covered per Phase 3 spec table)
- Critical modules (`permissions.ts`, `two-factor.ts`, `flags.ts`): verified via shared test run (408/408 pass; these modules are 100% covered — v8 text reporter omits 100%-covered files from output)

### Open questions / handoff notes

- Next agent: **analyst** for Phase 6.
- Known gap (inline-403 e2e path) is explicitly documented and not a blocker for PASS at starter scale.
- No auth-touching files in this feature — standard Phase 5 gate applies.

---

## Phase 6 — Shipped vs Intent — 2026-07-02

**Owner:** analyst
**Status:** complete

### Summary

**Verdict:** SHIP IT

**One-line take:** The audit log is now visible and filterable at `/admin/audit`, with proper permission gating, input guards with unit tests, and a clear fork note for SOC 2/HIPAA environments.

### What I did

**What's working:** `/admin/audit/page.tsx` is a pure Server Component — GET-form filters, grouped `<optgroup>` action select by prefix, actor text input, `<details>/<pre>` metadata (suppressed when `{}`), null-safe "—" for all nullable fields, `<FormattedDate>` timestamps, `overflow-x-auto` wrapper, two distinct empty states (zero-data vs. zero-filter), and parallel Drizzle `Promise.all` queries. The three input guards are extracted to `src/lib/audit-page-helpers.ts` with 13 unit tests. `ADMIN_AUDIT` permission key is in `FEATURES` and `FEATURE_CATALOG`; bound to the admin role via `bindAdminFeatures()`. Admin dashboard card and nav entry confirmed. SOC 2/HIPAA fork note in the page comment. The inline-403 path (a partial admin with `admin.dashboard` but not `admin.audit`) is a known gap documented in the e2e spec — no seeded user has this configuration; acceptable at starter scale.

**Intent-vs-shipped diff:**

- Phase 1 said: newest-first table with action/actor/resource/IP/user-agent/date columns. Shipped: all columns, `ORDER BY createdAt DESC`. Verdict: matches.
- Phase 1 said: filter by action key (server-rendered select) and actor email substring. Shipped: grouped `<optgroup>` action select by prefix (exceeds Phase 1 spec in a useful way) and actor text input. Verdict: matches — the optgroup grouping is better than a flat list.
- Phase 1 said: null fields render as "—". Shipped: null `actorEmail`/`ip`/`userAgent`/`resourceType`/`resourceId` all render "—". Verdict: matches.
- Phase 1 said: metadata suppressed when `{}`. Shipped: `Object.keys(row.metadata ?? {}).length > 0` guard on `<details>` block. Verdict: matches.
- Phase 1 said: no audit-of-viewing for the starter; SOC 2/HIPAA fork note. Shipped: no `recordAudit` in the page; SOC 2 comment at the top of `page.tsx`. Verdict: matches.
- Phase 1 said: new `admin.audit` permission key. Shipped: `ADMIN_AUDIT: "admin.audit"` in `FEATURES` and `FEATURE_CATALOG`. Verdict: matches.

**Edge cases:**

- Empty state: pass — zero-data empty state ("No audit events yet. Security-sensitive actions...") and zero-filter empty state ("No events match these filters.") are both present and distinct.
- Failure microcopy: not applicable — read-only page; a DB failure errors at the query level and surfaces at the Next.js global error boundary level.
- Permission gate: pass — `hasFeature(session.user.features, FEATURES.ADMIN_AUDIT)` inline-403 after session check; confirmed in Phase 5 feature-gate audit.
- Audit event: not applicable — read-only page; no audit-of-viewing by design (SOC 2 fork note documents the extension point).
- Mobile: pass — `overflow-x-auto` wrapper handles the multi-column table at 360px; `<details>` metadata element provides progressive disclosure.

### Outputs

- `src/app/(admin)/admin/audit/page.tsx` — new RSC page, verified.
- `src/lib/audit-page-helpers.ts` — input guard helpers, verified.
- `src/lib/audit-page-helpers.test.ts` — 13 unit tests, verified.
- `src/lib/permissions.ts` — `ADMIN_AUDIT` key and catalog entry, verified.
- `src/app/(admin)/admin/layout.tsx` — "Audit Log" nav entry, verified.
- `src/app/(admin)/admin/page.tsx` — Audit Log dashboard card, verified.
- `e2e/admin-audit.spec.ts` — 4 e2e tests, verified.

### Open questions / handoff notes

- Inline-403 e2e gap (partial admin without `admin.audit`): known and documented in the e2e spec comment. To close it, seed a partial-admin user. Out of scope for this pipeline.
