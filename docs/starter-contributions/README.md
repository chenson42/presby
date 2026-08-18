# Starter Contribution Kit

Backport candidates for **`chenson42/claudecode-nextjs-starter`** — the generic Next.js 16 +
Neon Postgres + Drizzle + NextAuth 5 (Google OAuth + credentials + TOTP 2FA) admin/auth starter.

> **Status (2026-07-13): historical spec source — do NOT work this file top-down.**
> Contributed via PR #3 (2026-07-01) from the Huddle Up fork and adopted here as reference
> material when that PR was closed as superseded. Live per-item status (DONE / BUG / OPEN /
> PARTIAL / LOW) and the execution order live in
> [`docs/reviews/2026-07-01-starter-contribution-triage.md`](../reviews/2026-07-01-starter-contribution-triage.md);
> open items are tracked in [`docs/TODO.md`](../TODO.md). Several entries below (A1, B1, B2, C2,
> C5, C6, D1, E1, F1, F3, G3 among them) have already shipped in this repo — the specs are kept
> intact for their origin stories, implementation detail, and verification steps.

**Origin:** every item here was built and **battle-tested in production** in a fork of this starter —
**Huddle Up** (`huddleup.health`), a cooperative wellness app. Each entry names the originating
DECISION / work-log / retrospective (files internal to that fork's repo) so the starter's own Claude
can judge fit and see the incident it solved. Product-specific work (the wellness domain:
health/coach/huddle/nutrition/sleep/Fitbit/sync) has been deliberately **excluded** — only
starter-generic improvements are here.

**How to read the entries.** Each is a self-contained mini-spec: *origin → problem → the generic
fix → where it lands in the single-root starter → implementation steps → verification →
classification*. Check the triage doc for an item's current status before lifting it into the
pipeline. **Path mapping:** the contributing fork is a monorepo, so its `web/src/...` maps to this
repo's `src/...`; `.claude/`, `.github/`, `docs/` map 1:1; `mobile/...` has no starter equivalent
(see §G).

**Classification legend.**
- `backport-ready` — drop-in; only strip repo/product names.
- `needs-generalization` — real generic value, entangled with product code/copy; extract the spine first.
- `process-doc` — a rule/convention/gate; edits to CLAUDE.md or an agent definition, no runtime code.
- `structural` — an architecture idea reviewed as a whole, not a file drop.

---

## §A — Database (Drizzle + Neon) guardrails & utilities

### A1. `check:sql-date` tripwire — ban the `sql<Date>` compile-time lie
**Origin:** DECISION-063 guard 1; retro `2026-06-28-retrospective.md` (Escape 2 was a production render crash); work-log `2026-06-28-retro-safety-guards.md`.
**Problem:** the Neon HTTP driver returns computed SQL expressions (`COALESCE`, `MAX`, `date_trunc`, casts) as **strings** at runtime, but `sql<Date>` tells TypeScript it's a `Date`. `tsc` passes; the first `.toISOString()`/`.getTime()` at render throws in prod. Static types can't catch it.
**Fix / steps:**
1. Add `scripts/check-sql-date.mjs`: scan `src/**/*.ts(x)` for `sql<Date`/`sql<string>` (etc.) on computed expressions; fail unless the line (or the line above) carries a `// sql-date-ok: <reason>` annotation.
2. Wire `"check:sql-date": "node scripts/check-sql-date.mjs"` into `package.json`, the CI workflow, and the `/pre-push` skill.
3. Document in the DB guidance: prefer `.mapWith()` / select the real column and compute the Date in JS; use `// sql-date-ok:` only when the value truly is a string you handle.
**Verify:** add a fixture line `sql<Date>\`now()\`` with no annotation → the check exits non-zero.
**Class:** `backport-ready`.

### A2. `isUniqueViolation()` helper + "user-scope every synthetic id" rule
**Origin:** DECISION-067; work-log `2026-06-27-fix-ingest-sampleid-cross-user-collision.md` (a real 500-for-everyone-but-the-first-user prod outage).
**Problem:** a deterministic synthetic key (`"<type>:daily:<epoch>"`) sat under a **global** unique index, so the first user to insert a given key claimed it table-wide and every other user's insert raised `23505` → unhandled → 500 → whole batch aborted. Also: catching a unique violation to return a warm "skipped" path was inlined in a route handler.
**Fix / steps:**
1. Ship `src/lib/db/errors.ts` exporting `isUniqueViolation(err)` (checks `err.code === "23505"`, `err.cause?.code`, and the message — the Neon driver nests the pg code).
2. Document the invariant in the database-admin agent: *any synthetic/deterministic id column MUST be scoped `(user_id, id)`; a bare global unique index on a cross-user-shared value is a footgun.*
**Verify:** unit-test `isUniqueViolation` against a raw pg error, a Neon-wrapped error, and a non-unique error.
**Class:** `backport-ready` (helper) + `process-doc` (rule).

### A3. Neon-HTTP driver gotchas: no transactions; `sql<boolean>` returns a string
**Origin:** work-log `2026-06-19-invite-chain-e2e.md`.
**Problem:** (a) `db.transaction()` throws *"No transactions support in neon-http driver"* — the starter's signup/verify-email paths assume transactions. (b) `sql<boolean>` on an `EXISTS(...)` subquery returns the **string** `"false"` (truthy in JS), silently corrupting a boolean.
**Fix / steps:**
1. Rewrite any multi-write starter action (signup, verify-email) as sequential **idempotent** `ON CONFLICT DO NOTHING` writes instead of a transaction.
2. For boolean projections use `CASE WHEN EXISTS(...) THEN 1 ELSE 0 END` and compare `=== 1` (or `.mapWith(Boolean)`).
3. Add both to a "Neon HTTP driver" section in the DB guidance.
**Verify:** the invite-chain e2e (signup → verify) passes; a `sql<boolean>` unit test asserts a real boolean.
**Class:** `backport-ready` (code) + `process-doc` (the two rules).

### A4. Hashed-at-rest opaque token util + per-purpose encryption keys
**Origin:** DECISION-007 (device bearer tokens), DECISION-037 + DECISION-072 Ruling 3 (dedicated keys), DECISION-019 (at-rest posture); the starter already hashes reset/invite tokens.
**Problem:** the starter hashes reset/invite tokens but has no shared primitive, and its AES-GCM code (in `two-factor.ts`) is bound to one env var — reusing a key for a second secret purpose couples their rotation.
**Fix / steps:**
1. `src/lib/tokens.ts`: `mintToken()` (`randomBytes(32).base64url`, revealed once), `hashToken(raw)` (`sha256hex`), `verifyToken(raw, hash)`. Schema convention: store `tokenHash` + `revoked`, never the raw.
2. `src/lib/crypto.ts`: promote the AES-256-GCM encrypt/decrypt to take the **env-var name** as a parameter (the `two-factor.ts` `key()` is already this shape). Invariant: *one key per secret purpose; independent rotation.*
**Verify:** round-trip unit tests for encrypt/decrypt + token hash/verify.
**Class:** `backport-ready` (utils) + `process-doc` (one-key-per-purpose).

### A5. Modeling doctrine — text+allowlist over `pgEnum`; dedicated table over JSON/columns-on-`users`; soft caps via COUNT; first-write-wins upsert
**Origin:** DECISION-008 / 065 (text+allowlist), DECISION-046 / 048 / 006 (dedicated tables), DECISION-008 (first-write-wins).
**Problem:** `pgEnum` forces un-rollback-able `ALTER TYPE` migrations; JSON blobs make per-row CRUD/caps awkward; bolting optional state onto the adapter-owned `users` table couples migrations; last-write-wins upserts let a buggy retry overwrite good data.
**Fix:** document four schema conventions in the DB guidance: (1) enumerable columns = `text` + a validated allowlist constant (add a value = additive code change); (2) independent/optional per-user state = its own table FK'd to `users` (droppable without a `users` migration); (3) soft caps enforced app-side via `COUNT` before insert, not a DB constraint; (4) upserts prefer first-write-wins (`DO NOTHING` or guard) for idempotent retries.
**Class:** `process-doc`.

### A6. `xmax` net-new upsert-count technique
**Origin:** Huddle Up sync-now endpoint (2026-07-01); verified on Neon (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING (xmax = '0'::xid) AS inserted` → `0`/true for inserts, non-zero/false for updates).
**Problem:** reporting "N new rows added" after an upsert batch normally needs a second SELECT.
**Fix:** document the snippet in the DB guidance as the blessed way to count net-new inserts in one round-trip (with the caveat that it's a Postgres system-column trick, not SQL-standard).
**Class:** `process-doc` (snippet).

### A7. Migrate-before-deploy ordering + don't-delete-flag-rows
**Origin:** DECISION-072 Ruling 11; `migration-deploy-ordering` + `flag-deletion-deployment-skew` memories.
**Problem:** NextAuth's unconstrained `users` `findFirst` in `auth.ts` selects **all** columns, so a column present in code but missing in the prod DB breaks **all** login (not just the new feature). And deleting a retired `feature_flags` row flips the feature OFF for sessions pinned to an older deployment that still reads it.
**Fix:** deployment-docs invariants: *apply schema migrations to prod BEFORE deploying code that reads new columns; never DELETE a retired flag row — leave it in place.* Optionally a `/pre-push` check that the migration journal is applied.
**Class:** `process-doc`.

### A8. Build-step migration (atomic schema+code deploy)
**Origin:** review `2026-06-28-ux-consistency.md` Tier-3 #10 ("Strong upstream candidate").
**Problem:** hand-applying migrations before a deploy is error-prone; the race window is exactly the A7 outage.
**Fix:** run `drizzle-kit migrate` in the Vercel **build** command, guarded on `VERCEL_ENV === "production"`, so code + schema ship atomically. Document the build-command pattern.
**Class:** `needs-generalization`.

---

## §B — Auth / session

### B1. `cachedAuth` (React `cache()` wrapper) + `cache()`-wrapped `isFlagEnabled`
**Origin:** DECISION-055-era perf work; work-logs `2026-06-24-perf-quick-wins.md`, review `2026-06-24-performance.md` P2.
**Problem:** `auth()` isn't wrapped in React `cache()`, so its per-request JWT stale-check `SELECT users` runs **twice** per authenticated render (layout + page); `isFlagEnabled` hits the DB once **per call**. 3–4 serial Neon round-trips per hot page.
**Fix / steps:**
1. `src/lib/auth/cached-auth.ts`: `export const cachedAuth = cache(auth)`; switch **Server Component** session reads to it (leave server actions / route handlers / Edge middleware / signIn-signOut on bare `auth()` — document why).
2. Wrap the `isFlagEnabled` body in `cache()` so each flag key hits the DB at most once per render.
**Verify:** an e2e covering every switched call site (session still resolves; flags still gate).
**Class:** `backport-ready`.

### B2. Stale-JWT re-read + `session-projection.ts` seam
**Origin:** DECISION-114.
**Problem:** without a re-read, DB-side role/setting changes need `unstable_update`; ad-hoc `session` mutations scatter and ship stale-permission bugs.
**Fix:** ensure the starter ships `src/lib/auth/session-projection.ts` as the single seam mapping DB columns → `token` → `session.user`, backed by the per-request DB re-read in `auth.ts`. Invariant: *add new session fields via `session-projection` + a `next-auth.d.ts` augmentation; rely on the per-request re-read, not `unstable_update`.*
**Class:** `process-doc` (reinforces an existing primitive).

### B3. Provider-aware `signInGate` — OAuth linking for an existing local account
**Origin:** work-log `2026-06-21-google-signin-existing-account.md`.
**Problem:** first-time Google sign-in for an email that already has a credentials account is rejected because Auth.js passes the Google `sub` (not a DB uuid) as `user.id` for unlinked accounts, so `eq(users.id, user.id)` misses → `AccessDenied`.
**Fix / steps:** extract `src/lib/auth/sign-in-gate.ts` — credentials look up by DB id; OAuth looks up by **verified, lowercased email**; allow linkage only for an existing **active** account. Take DB ops as injected deps for unit-testability.
**Verify:** unit tests for credentials-path, OAuth-existing-account, OAuth-unknown-email.
**Class:** `needs-generalization` (strip the invite/closed-beta branch to a config flag).

### B4. 2FA fresh-recovery-codes: cookie mutation out of RSC render
**Origin:** work-log `2026-06-19-fix-2fa-cookie-in-rsc.md`.
**Problem:** `cookies().delete()` during a Server Component render is forbidden in Next 16, so in prod the fresh recovery codes re-displayed on every reload.
**Fix / steps:** split read (`readFreshCodesCookie`, RSC-safe) from mutation (`clearFreshCodesCookieAction`, a Server Action fired from a `<FreshRecoveryCodes>` client component's `useEffect`); carry enrollment-success via a `?enrolled=true` URL param instead of `revalidatePath` (beats the post-action RSC re-render race). Port to both `(account)/account/2fa` and `(admin)/admin/2fa`.
**Verify:** the two regression specs (codes show once, don't re-display on reload).
**Class:** `backport-ready`.

### B5. Signed single-use OAuth state token + nonce table
**Origin:** DECISION-072 Rulings 2/3/5 (module noted "reusable across any OAuth flow").
**Problem:** httpOnly-cookie CSRF state breaks when an OAuth flow runs in a separate cookie jar (system browser, mobile shell, any cross-context redirect).
**Fix / steps:** `src/lib/auth/oauth-state.ts` — `mintState()` → `base64url(payload).base64url(hmac_sha256(payload, OAUTH_STATE_SECRET))` where payload is `{ userId, nonce, exp }`; `verifyAndConsumeState()` checks the HMAC + a single-use `oauth_state_nonces` row (delete on consume; lazy expired-row cleanup at mint, no cron). New env var `OAUTH_STATE_SECRET` (≠ `AUTH_SECRET`).
**Verify:** unit tests for tamper, replay (second consume fails), expiry.
**Class:** `needs-generalization`.

### B6. Native-shell sign-in via a Credentials provider (local JWKS verify)
**Origin:** DECISION-022 / 023 / 024.
**Problem:** OAuth redirects are blocked inside a WebView; and NextAuth's DrizzleAdapter does **not** fire `events.createUser` for Credentials providers, so new-user creation must happen inline in `authorize()`.
**Fix:** document a `native-oauth` Credentials-provider recipe — verify the provider ID token locally against cached JWKS (5-gate checklist: signature, `aud`, `iss`, `exp`, `email_verified`), and do inline user creation inside an extracted, DI-testable `authorize` helper.
**Class:** `needs-generalization` (pairs with §G structural).

---

## §C — QA / process gates (the "safety guards" bundle)

> DECISION-063 bundled four guards closing four real production escapes. C1+C2 are drop-in code; C3+C4 are gates. Ship these first — smallest surface, biggest escape-rate win.

### C1. Cadence-check SessionStart hook
**Origin:** DECISION-063 guard 2; retro cadence-finding (a 7-day retro slipped 5 weeks because the rule only fired when an agent was invoked).
**Fix / steps:** `scripts/cadence-check.mjs` parses `docs/reviews/log.md`, compares each review type's last entry to its cadence, prints overdue ones; wire as a `hooks.SessionStart` entry in `.claude/settings.json`.
**Class:** `backport-ready` (assumes the starter's review-log format).

### C2. `check:audit` tripwire — every mutation references an `AUDIT_ACTIONS` key
**Origin:** CLAUDE.md Common Commands + Workflow Rule 7; green across the test-coverage reviews.
**Fix / steps:** `scripts/check-audit.mjs` walks every `actions.ts`, greps for `db.insert/update/delete` lacking an `auditEvents` write or a `// audit-exempt: <reason>` annotation; wire into an npm script + `/pre-push`.
**Class:** `backport-ready` (ships with the existing `audit_events` infra).

### C3. Rendered-page smoke gate (any UI/page-touching feature)
**Origin:** DECISION-063 guard 3; retro Escape 3 (a dead affordance shipped green).
**Fix:** a Phase-5 gate in `qa.md` + the pipeline docs: QA must start the dev server, load affected page(s) with ≥1 seeded/real row, exercise every interactive element, and record pass/fail in the work-log. A skipped smoke on a UI feature → `BLOCKED`, not `PASS`.
**Class:** `process-doc`.

### C4. Cross-user unique-constraint fixture gate
**Origin:** DECISION-063 guard 4; the A2 outage.
**Fix:** a Phase-5 gate: any migration adding a `uniqueIndex()` **not** prefixed by `user_id` requires a ≥2-user fixture inserting the same natural key under two user IDs and asserting the second insert succeeds. Missing fixture → `BLOCKED`.
**Class:** `process-doc`.

### C5. Auth-touching change requires a running-server e2e login smoke (incl. MFA user)
**Origin:** CLAUDE.md Phase-4/5 gates; review `2026-06-24-performance.md` P2 (the `cache(auth)` change).
**Fix:** a gate: any change to `auth.ts`, `(auth)/`, `api/auth/`, or `lib/auth/` must pass a running-server e2e over the full login path including an **MFA-enrolled seeded user** before Phase 5 can `PASS` — catches module-resolution defects unit tests miss.
**Class:** `process-doc` (needs the seeded-MFA e2e fixture, §D1).

### C6. Escape-rate telemetry — `fix:` trailers + commit-msg hook + `stats:escape`
**Origin:** retro `2026-06-28-retrospective.md` (surfaced "0% test-caught, 57–70% prod-caught").
**Fix / steps:** require two trailers on every `fix:` commit (`Caught-By: automated-test|agent-review|human-review|production`, `Discovered-In: Phase-N|post-merge|production`), a commit-msg hook enforcing them, and `scripts/stats-escape.mjs` producing a 30-day escape-rate report over `git log` for the retro.
**Class:** `backport-ready`.

### C7. Ship-live-by-default + flag classification + flag-debt audit + operator-smoke sign-off
**Origin:** DECISION-073, review `2026-06-28-feature-flag-cleanup.md` (31 flags → 7), retro Change 4, CLAUDE.md Rule 13.
**Fix (process-doc bundle):**
- **When to flag:** only an operational **kill-switch** (risky/external/expensive integration) or a genuinely **mid-build dark** feature. Everything else ships live; a finished always-on flag is debt.
- **Flag-debt audit:** a 30-day review — table every flag, classify KEEP-KILLSWITCH / KEEP-DARK / RETIRE / DELETE-FEATURE, enumerate call-sites + the off-path code deleted, batch by file-overlap.
- **Delete-feature checklist** + **flag-row hygiene** (leave the row; see A7).
- **Flag-free ship** requires a work-log line: "Operator smoked the live page at [URL] on [date]"; absent → `SHIP WITH NOTES`, not `SHIP IT`.
**Class:** `process-doc`.

### C8. Dead-code / unused-dependency sweep playbook
**Origin:** work-log `2026-06-29-dead-code-batch.md`.
**Fix:** a code-review-agent playbook: `grep -rl <symbol> src` to confirm zero importers before deleting; build+typecheck as arbiter; de-export (don't delete) symbols still used internally; prune npm deps at 0 references; keep test-only exports.
**Class:** `process-doc` (optional `check:deadcode` helper).

---

## §D — Tooling / CI / infra

### D1. e2e prod-DB isolation guard + self-cleaning specs
**Origin:** work-log `2026-06-27-e2e-prod-isolation.md`. **(Prerequisite for C5.)**
**Problem:** dev/e2e and prod can share a Neon DB, so the required auth e2e gate can silently pollute prod.
**Fix / steps:** `e2e/global-setup.ts` refuses to run when `DATABASE_URL` is a `neon.tech` host unless `E2E_DATABASE_URL` (isolated branch) or `E2E_ALLOW_SHARED_DB=true` is set (host-string check, no secrets parsed); wire `globalSetup` in `playwright.config.ts`; document both env vars (+ the `E2E_BASE_URL`/port gotcha) in `.env.example`; seeded specs hard-delete their rows in `afterAll`, scoped by a unique per-run email/name prefix.
**Class:** `backport-ready`.

### D2. DB-sync GitHub Action (auto-apply migrations + insert-only seed on merge)
**Origin:** `.github/workflows/db-sync.yml` (commit `1c7d681`).
**Problem:** features shipped whose migration/flag row was never hand-applied to prod.
**Fix / steps:** on push to `main`, run `drizzle-kit migrate` then `scripts/seed.ts` with `SEED_MODE=clean` (idempotent, insert-only — never resets operator-flipped flags) against `PROD_DATABASE_URL`, in parallel with the Vercel deploy; a `concurrency` group prevents racing migrate runs. Generalize the hardcoded `github.repository ==` guard to a **secret-presence** check so forks skip cleanly.
**Class:** `needs-generalization`.

### D3. Vercel cron convention — auth-first, GET-not-POST, namespace, `vercel.json` placement
**Origin:** DECISION-032 / 041; review `2026-06-28-ux-consistency.md` Tier-3 #9.
**Problem:** Vercel cron fires **`GET`**; a `POST` handler 405s silently on every fire (no build/type error). And `vercel.json` must sit at the Vercel **project root** (`web/` in a monorepo, else repo root).
**Fix:** ship an example `src/app/api/cron/<job>/route.ts` exporting `GET`, validating `Authorization: Bearer ${CRON_SECRET}` as the **first** operation (skip the version-flaky `x-vercel-cron-signature`); document the same secret for internal fire-and-forget offload (`void fetch(internalRoute, { headers: { Authorization: Bearer CRON_SECRET }})`); note the `vercel.json` placement. Optional `scripts/check-cron-method.mjs` cross-references `vercel.json` cron paths against exported handlers.
**Class:** `backport-ready` (example + env) + `process-doc`.

### D4. App-wide Content-Security-Policy header
**Origin:** security review `2026-06-22-security.md` O-4.
**Fix:** a default CSP in `next.config.ts` headers, with documented per-fork `connect-src`/`img-src` allowances.
**Class:** `needs-generalization`.

---

## §E — Reusable UI primitives

### E1. Timezone-safe `<FormattedDate>` + ESLint ban on `toLocale*`
**Origin:** CLAUDE.md Key Invariant "Timezone-Safe Date Rendering".
**Problem:** direct `toLocaleString/DateString/TimeString` in components produces server/client hydration mismatches for UTC-stored timestamps.
**Fix / steps:** ship `src/components/shared/formatted-date.tsx` (`<FormattedDate value mode="date|datetime" />`) + a custom ESLint rule (or `no-restricted-syntax`) forbidding `toLocale*` in components.
**Class:** `backport-ready`.

### E2. Overlay-pattern rule + keyboard-safe centered Dialog primitive
**Origin:** review `2026-06-28-ux-consistency.md` §1 + Tier-3 #1 (+ agent-rubric edits).
**Problem:** a bottom Sheet holding a text input sits *under* the iOS keyboard; hand-rolled `div` overlays lose focus-trap/Escape/`aria-modal`/scroll-lock.
**Fix:** a binding rule (CLAUDE.md "UI Conventions" + `ux-developer`/`architect` rubrics): text-input overlays → **center-anchored Radix Dialog** (`left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2`, tracks the shrunk-viewport center); selection-only → Sheet; hand-rolled div → forbidden. Ship the centered-Dialog primitive in `src/components/ui/`. Plus a ≥2–3-call-site extraction threshold routing new-primitive decisions to the architect.
**Class:** `process-doc` (rule) + `needs-generalization` (primitive).

### E3. `useOptimisticToggle` hook
**Origin:** review `2026-06-28-ux-consistency.md` §7 + Tier-3 #2.
**Fix:** ship a React 19 hook wrapping snapshot → optimistic-set → `startTransition` → reconcile-or-rollback + `toast.error` + `isPending`. API: `useOptimisticToggle<S>(initial, action) → { state, toggle, isPending }`.
**Class:** `needs-generalization`.

### E4. `Button` + `Pill` variants (the missing shadcn pieces)
**Origin:** review `2026-06-28-ux-consistency.md` §5/§6 + Tier-3 #3 ("there is no `button.tsx`").
**Fix:** add `src/components/ui/button.tsx` (`default|outline|ghost|destructive`, `rounded-xl` default) and `src/components/shared/pill.tsx` (`hue` enum status badge). The starter ships no `Button`, so forks hand-roll and drift.
**Class:** `backport-ready` (Button) / `needs-generalization` (Pill hues).

### E5. `EmojiPicker`
**Origin:** review `2026-06-28-ux-consistency.md` §2 + Tier-3 #4.
**Fix:** ship `src/components/shared/emoji-picker.tsx` — an allowlist of emoji as accessible `button`s (`aria-pressed`, `aria-label`, click-to-toggle/clear) with `layout|size|ringColor|clearable` props.
**Class:** `needs-generalization`.

### E6. Responsive admin shell
**Origin:** work-log `2026-06-27-admin-mobile-responsive.md`.
**Problem:** the inherited `grid-cols-[220px_1fr]` admin layout overflows at 360px; wide admin tables clip.
**Fix / steps:** a scrollable pill-row nav header on mobile (`md:hidden`, `overflow-x-auto`, 44px targets, `pt-safe`), sidebar restored at `md:`; wrap wide admin tables in `overflow-x-auto` + `min-w-*`. Desktop unchanged.
**Class:** `backport-ready`.

### E7. Branded, client-safe HTML email template
**Origin:** work-log `2026-06-22-branded-emails.md`.
**Fix / steps:** `src/lib/email-template.ts` — table-based, fully-inlined-styles, no flexbox/`<style>`/web-fonts, with preheader span, centered card, optional bulletproof CTA, footer, and **mandatory `escapeHtml` of every interpolated user string**; refactor the starter's invite / password-reset / email-change senders onto it via a palette/wordmark config seam.
**Verify:** unit tests for injection escaping + the no-CTA path.
**Class:** `needs-generalization`.

---

## §F — Reusable features (self-contained increments)

### F1. What's New — member changelog digest (+ flag-gating)
**Origin:** DECISION-055; work-log `2026-06-27-usage-analytics.md`; review `2026-06-28-ux-consistency.md` Tier-3 #11 ("Strong upstream candidate").
**Fix / steps:** `whats_new_entries` table (emoji/title/body/published_at + a **nullable `feature_flag`** column) + a `users.whatsNewSeenAt` marker advanced on dismiss + an auto-opening member sheet + a `/admin/whats-new` authoring page. The unseen/archive queries filter on `isFlagEnabled(feature_flag)` so changelog entries for dark features stay hidden automatically.
**Class:** `needs-generalization` (strip product copy; keep the spine).

### F2. Usage heartbeat + `/admin/usage`
**Origin:** DECISION-055; work-log `2026-06-27-usage-analytics.md`.
**Fix / steps:** a `touchUserActivity()` server action called from the app layout with a **SQL-level 1-hour debounce** (`WHERE last_active_at < now() - interval '1 hour'`) writing `users.lastActiveAt` / `lastActivePlatform`; a read-only `/admin/usage` page behind an `admin.usage` permission. Fail-open + privacy invariant (no FK join path from activity columns into a grouping surface). (The native build-version-gate leg stays product-side.)
**Class:** `needs-generalization`.

### F3. In-app feedback capture + triage
**Origin:** DECISION-046.
**Fix / steps:** a `feedback` table (category, body, contextPath, appVersion, status `new→triaged→done`) + a `feedback_prompt_state` table (per-user opt-out / snooze / last-submitted), a minimal `/feedback` action, an admin triage list, and a SessionStart surfacing hook. Both tables FK only to `users`.
**Class:** `needs-generalization`.

---

## §G — Structural

### G1. Monorepo `web/` + `mobile/` split
**Origin:** the Huddle Up repo layout.
**Idea:** restructure the single-root starter into `web/` (the Next.js app + all keys/proxy/cron) + `mobile/` (Capacitor iOS/Android shells that wrap the web app in a WebView and add on-device capabilities), with all third-party keys living only in `web/`. Enables native shells without a second backend. A scaffolding change reviewed as a whole.
**Class:** `structural`.

### G2. `mobile-developer` agent
**Origin:** `.claude/agents/mobile-developer.md`.
**Idea:** an agent that owns `mobile/` — Capacitor scaffolding, native health/data reads, push registration (APNs/FCM), sync scheduling — while the web agents own `web/`. Only meaningful alongside G1.
**Class:** `structural`.

### G3. `downstream-sync` skill
**Origin:** `.claude/skills/downstream-sync/` (this kit's own tool).
**Idea:** ship the skill that produces exactly this kit — so every fork gets a repeatable "contribute back" pass. Repo-agnostic; drop-in.
**Class:** `backport-ready`.
