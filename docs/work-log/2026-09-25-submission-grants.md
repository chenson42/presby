# Statistical-return submission grants — increment 6 (D16, Section P: submission without an account) — Work Log

> **Slug:** `2026-09-25-submission-grants`
> **Surface:** mixed — presbytery-side issuance inside `(org)`; a public, token-consuming submission flow in its own route group (Ruling 11: e.g. `(statistics-submit)`, platform palette, no session, enumeration-safe)
> **Permission(s):** analyst to name: the presbytery-side tenant permission for issuing/revoking a grant (resolver-based, `presby_effective_permissions`), and the explicit statement that the token flow carries no `FEATURES.*` gate — the token is the credential
> **Flag(s):** analyst to decide — likely a flag for the public submission endpoint (the first unauthenticated write path in the platform), seeded off
> **Estimated complexity:** large
> **Pipeline mode:** Full
> **Workflow Rule 16 kickoff (orchestrator, 2026-09-25):** worktree `../presby-wt-grants` on git branch `pipeline/submission-grants`; Neon branch `pipeline-submission-grants` (`br-noisy-shape-axiyl9zi`, forked from `development` at the v0.25.2 state — `drizzle/0043`–`0047` applied, 15 fixture orgs); the worktree's `.env.local` points every connection at that branch. **Pre-assigned numbers:** migration `drizzle/0049_presby_submission_grants.sql`; `DECISION-147`; findings none pre-assigned; the pipeline's own security pass may open a series in a new lettered subsection of `docs/schema-design-2.md` at integration. **Shared-file discipline:** `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts` and `drizzle/meta/_journal.json` may be edited on this branch only as a clearly delimited block appended at the END of the file (one new section, one new export line, one new journal entry) so integration merges are mechanical; `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*` and `CLAUDE.md` are NOT edited on this branch — each phase returns its proposed lines in its section and the orchestrator applies them at integration. Integration is one PR at a time through `/merge-pr`, with `test-rls.sql` re-run on the merged `development` branch before the next lands. Dev-server port for this pipeline: `3300`; Playwright `outputDir` under the worktree.
> **Design authority:** `docs/schema-design-2.md` §6 "Section P — Submission without an account" (the `statistics_submission_grants` shape — the grant is a CREDENTIAL, single-purpose, single-year, single-congregation, expiring; `token_hash` never the token; one live grant per `(organization_id, about_org_id, report_year)`; a grant submission writes a `statistical_returns` row owned by the CONGREGATION with `provenance = 'submitted'`, attested, form-version-validated, plus an automatic `publications` row to the issuing presbytery; an `unmanaged` congregation's return sits in a tenant nobody can enter, by design — D9 handover). `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md` Phase 2 **Ruling 11** pre-places the endpoint: its own public route group, platform palette (DECISION-047), no session, no `FEATURES.*` gate, `check:audit` expectations settled here. Phase 2 Notes item 4 and Phase 3 confirmed increment 6 as its own work-log with its own security pass. **The write must go through the sanctioned publishing path** — `presby_publish_sasr_snapshot()` arms `presby.publication_write_active`; a grant submission is the second caller and must not add a second arming site outside a `SECURITY DEFINER` function (F55/DECISION-141, "creation guarded as strongly as mutation"). Attestation identity (F57): the return records `attested_at`, `attested_by_name`, `attested_role` — this pipeline is the first that has a named attester, so it may be where the attestation columns first carry non-null values.
> **Prior art:** `password_reset_tokens` (token-hash precedent, `src/lib/auth/`), `(password-reset)` and `(email-verify)` route groups (token-consuming public flows, enumeration-safe copy), `src/lib/rate-limit.ts`, `src/lib/presbytery.ts` (`setCongregationStatistics()`, the rollup), `src/lib/db/domain/returns.ts` / `publication.ts`, `scripts/seed-dev.sql`'s publication chain (~`:1374-1399`).
> **Rate-limit issuance and submission** — an unauthenticated write endpoint scoped by a guessable `(org, year)` is the surface the security pass looks at hardest.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (five open questions; orchestrator working assumptions recorded at the end of the section) | READY WITH NOTES | 2026-09-25 |
| 2 — Architectural review | architect | Complete — eleven BINDING gates; new finding F80 (two affiliation instants in the shipped chain); DECISION-147 text proposed | Approved with suggestions | 2026-09-25 |
| 3 — Technical design | tech-lead | Complete — F80 ruled, affiliation instant ruled, `managed` exclusion ruled, full DDL, `check:audit` extension taken | Design complete, implementer named | 2026-09-25 |
| 4 — Implementation | database-admin → api-developer → ux-developer | **Complete** — batch A (schema), batch B (server) and batch C (client) all landed: drizzle/0049 applied, test-rls.sql 456/456 as presby_app, `npm test` 3294/814/0, `npm run check`/`typecheck`/`build` clean, e2e smoke 7/7 twice; batch C's own review caught and fixed a page-level enumeration-safety gap (flag-off leak in `previewGrantedReturn`'s caller) before Phase 5 | — | 2026-09-25 — second passes closed QA FAIL-1 (org-keyed issuance rate limit, 30/hour) and Advisories 1–3, 6 |
| 5 — Verification | qa | Complete — full independent pass (live catalog, six-cause enumeration byte-diff + timing, concurrent double-claim, chain + F39, 360×800 browser, e2e 7/7 on a real server); FAIL on one gap: issuance rate limit absent (Phase 1 + Phase 2 requirement dropped at Phase 3) | **re-verified PASS** — FAIL-1 closed and proven live (blocked on attempt #31); Advisories 1, 2, 3, 6 closed on live rows; test-rls 456, npm test 3308, e2e spec 7/7 twice | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete — shipped as v0.26.0 | SHIP WITH NOTES | 2026-09-25 |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-09-25.*

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A presbytery clerk can now issue a one-time, expiring, token-authenticated link that lets a congregation with no account file its SASR return through a public, enumeration-safe, platform-chrome page — the schema layer (`docs/schema-design-2.md` §6, `drizzle/0046`/`0047`) has already done the hard adversarial thinking for the *data model*, but three load-bearing decisions about the *write path and its actors* are still open, and shipping past them without a ruling is how this feature grows a second confused-deputy hole next to the one increment 5 just spent six loop-backs closing.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Authenticated member — presbytery admin (`/o/[slug]/admin/reports`, likely extension of the existing page) | Issue a submission grant (congregation + report year + recipient name/email) | On demand, per congregation per year |
| Presbytery admin | Revoke a live grant | On demand |
| Presbytery admin | Re-issue a grant after revoke/expiry for the same (congregation, year) | On demand |
| Presbytery admin | See grant status (issued / expired / revoked / submitted) | On demand |
| Anonymous visitor (holds an emailed token, no account, no session) | Open the link | One-time |
| Anonymous visitor | View the SASR form for that report year's `form_version_key` | One-time |
| Anonymous visitor | Fill the form fields | One-time |
| Anonymous visitor | Attest their name and office (clerk of session / moderator) | One-time |
| Anonymous visitor | Submit | Exactly once — a design requirement, not a suggestion |
| Presbytery (recipient council) | See the return arrive | Per submission |
| Congregation, if `managed`/`invited` and a member exists | View own filing history | On demand — **new surface; no page exists anywhere in `src/app/` today** |

The one omission: the request doesn't say which surface or permission governs "the congregation sees its own return," and the read path for that already exists at the database with zero UI consumers.

## Flows

**Flow 1 — Issue a grant:** presbytery admin's reports page → pick a member congregation (must reuse the existing parent-path check pattern, `resolveMemberCongregation`'s `servingOrgId` check — Adversarial #5) + report year + recipient name + email → submit → grant row created, `token_hash` stored, raw token emailed, UI shows "issued, expires <date>." Failures not named in the request: a live grant already exists for `(organization_id, about_org_id, report_year)` — the partial unique index rejects it; the UI must translate that into "a grant is already outstanding for this year — revoke it first," not a raw constraint violation. The email enqueue succeeds but delivery later bounces (async queue, `src/lib/email/queue.ts`) — does the issuing clerk ever learn the recipient never got the link?

**Flow 2 — Revoke / re-issue:** "Revoke" on a live grant → confirm via a shadcn `AlertDialog` (Rule 2) → `revoked_at` set; re-issue becomes possible. Failure: revoking an already-submitted grant — nothing to revoke; the UI must distinguish "already filed" from "revoked, never filed."

**Flow 3 — Recipient submission:** emailed link, opaque token only → page resolves the grant server-side and renders the form for its `form_version_key` → fill, validate client- and server-side → type name + office → submit → a `statistical_returns` row owned by the congregation, a `publications` row addressed to the presbytery, a `congregation_statistics` projection row, and the grant stamped `submitted_at`/`return_id`. Plain confirmation page — no login, no further access. Failure states (expired, revoked, already-submitted, nonexistent, form-version mismatch, flag-off) must be **indistinguishable from each other** — Adversarial #3.

**Flow 4 — Presbytery sees the return arrive:** the "Congregation reported" badge (`src/app/(org)/o/[slug]/admin/reports/statistics-table.tsx:14`) already renders once a `congregation_statistics` row with `provenance = 'published_by_congregation'` exists — **already half-built**, provided the new write produces the same projection `presby_publish_sasr_snapshot()` does. Failure not described: if the three-table write aborts partway, does the grant end up stamped with no visible return? This must be one transaction.

**Flow 5 — Congregation sees its own filing history (new):** `presby_list_own_congregation_publications()` (`drizzle/0038`, **already built, SECURITY DEFINER, called from nowhere in `src/`**). Empty state not addressed.

## Permissions & Flags

- **Issuance/revocation:** reuse **`statistics.manage`** (`drizzle/0038:714`, tier 2, module `presbytery`, bound by default to `presbytery_stated_clerk`) rather than minting a new key — its description already covers issuing a grant as an alternate mechanism for the same duty. Split into `statistics.grant` later only if independently auditable authority is needed.
- **Congregation's own "view filing history":** no new permission — a read of the org's own record, gated by membership alone; `statistics.publish` is a defensible alternative. Needs a ruling.
- **Public submission endpoint:** no `FEATURES.*` gate — the token is the credential (Ruling 11).
- **Flag:** new key, e.g. `statistics.submission_grants`, seeded **off**, gating both the issuance UI and the public endpoint (one flag, two surfaces, matching `org_portal.reports`). Flag-off on the public page must render the **same generic copy** as an invalid token — otherwise flag state is an oracle. Bare `isFlagEnabled()` (fail-closed) is **correct** here — this gates a write, not a sign-in path.

## Gaps the Request Didn't Address

- **2FA gate:** n/a for the anonymous recipient; standard `(org)` 2FA applies to the issuing admin.
- **Audit events:** the most security-sensitive mutation in the platform (an unauthenticated write) and no audit story named. Minimum: grant-issued, grant-revoked, grant-submitted. The submission has no session — use `recordAudit()`'s `actor: { userId: null, email }` override (the shape `(password-reset)/actions.ts` uses), grant id as `resourceId`, both organization ids in `metadata`. Phase 3 must state whether the submission write lives in a file `check:audit` scans (`actions.ts`) or is an intentional exemption.
- **Empty state:** the grant-issuance section and the filing-history page both need one.
- **Failure microcopy:** a DB/network failure on the anonymous page needs one generic "nothing was saved, try the link again" message indistinguishable from an invalid-token response.
- **Mobile:** the SASR form is ~60 fields at 360px, handed to a non-technical volunteer on a phone — a real UX problem never mentioned.

## Adversarial Pass

1. **Redirect targets:** none in the flow — confirm the confirmation page accepts no `callbackUrl`/`next`.
2. **State-machine shortcuts:** the submission claim must be a single atomic `UPDATE … WHERE submitted_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING`, mirroring `consumeResetToken` — otherwise a double-click, back-button resubmit or two tabs file two returns off one grant.
3. **Enumeration leaks — the central finding.** The URL carries **only** the opaque high-entropy token (32-byte CSPRNG, `requestPasswordReset` precedent) — never a slug, name or year. Every failure state — expired, revoked, already-submitted, malformed, nonexistent, flag-off — renders **identical** copy at **identical** response time (DECISION-040's "including its response time"). Once valid, the org's identity/logo may show, but nothing about *other* organizations (no roster autocomplete, no sibling names in errors).
4. **Input boundaries:** the SASR payload is protected by `presby_enforce_sasr_field_spec()`; `attested_by_name`/`attested_role` and the office field are plain columns — length bounds and Unicode handling need explicit server-side validation.
5. **Self-targeting:** can a presbytery admin issue a grant naming an `about_org_id` that is not its own child? `resolveMemberCongregation`'s parent-path re-resolution must gate the picker — otherwise a presbytery could fabricate a "submitted" return for another presbytery's congregation.
6. **The mid-year affiliation transfer — a genuine unresolved design conflict.** Three precedents disagree on which instant governs a cross-council write: `presby_publish_sasr_snapshot()` resolves the recipient via `presby_affiliation_parent_as_of(v_org, current_date)` — **today's** council; `statistical_returns_about_org` (imported provenance) checks affiliation at either endpoint of the **report year**; a grant's own `organization_id` freezes a third instant — the presbytery live at **issuance**. Phase 3 must rule before database-admin writes the function.
7. **Concurrent self-filing:** a `managed` congregation's own clerk with `statistics.publish` can self-publish the same year while a grant is outstanding; `fetchStatisticsForYear`'s latest-`published_at` coalesce picks a winner silently. D16's rationale suggests grants should be **restricted to `unmanaged`/`invited` congregations** — making the conflict structurally impossible.

## Out of Scope (confirm with user)

`presby_withdraw_publication()` UI; the D13 import pipeline (increment 7); push notification to the presbytery on arrival; correcting a mistyped recipient email post-issuance (revoke + re-issue).

## Open Questions

1. **Who may issue a grant** — presbytery staff only, or may a congregation's own clerk request one for itself? (Recommendation: presbytery staff only.)
2. **Which affiliation instant governs a grant-submitted return's recipient** when it disagrees with the grant's frozen `organization_id` (Adversarial #6)?
3. **Should grant issuance be permitted for a `managed` congregation**, or restricted to `unmanaged`/`invited` (Adversarial #7)?
4. **Is the congregation-side "filing history" page in scope?** The DB read exists and is called from nowhere; Ruling 11's framing was "increment 6 ships DDL only," and this work-log has grown past that.
5. **Does the presbytery get any notification when a return arrives**, or does the clerk check the reports page?

### Orchestrator working assumptions (2026-09-25) — stated to the operator, overridable while design is open

1. **Presbytery staff only** issue grants (`statistics.manage`); a congregation's own clerk uses the existing `statistics.publish` self-serve path.
2. **Tech-lead rules** on the affiliation instant at Phase 3; the architect states the invariant constraint.
3. **Restrict grants to `unmanaged` and `invited` congregations** — the D16 rationale, and it makes the concurrent-self-filing conflict structurally impossible rather than tolerated. A `managed` congregation is told to file through its own portal.
4. **Filing-history page deferred** to its own Polish/feature work-log; this pipeline ships DDL + the grant-issuance section + the public submission flow. The existing "Congregation reported" badge is the presbytery-side arrival surface.
5. **No push notification** — in-app badge only; a notification is a follow-up if asked for.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-25 |

**Handoff:** to **architect** (Phase 2). Carry forward every item under Gaps/Open Questions verbatim; the architect should confirm route-group placement against Ruling 11 (a new public route group, e.g. `(statistics-submit)`, platform palette, no session) given the larger-than-DDL scope, and weigh in on directory placement for the issuance UI and the public flow.

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-09-25. The architect's proposed finding is numbered **F80** in this pipeline's series (F80–F64 belong to the lifecycle pipeline's third external round, F70+ to the security pipeline); every occurrence of "F80" below reads F80.*

## Verdict

**Approved with suggestions.** The feature shape is right and Ruling 11's placement survives the larger-than-DDL scope. Eleven items below are marked **[BINDING]** — they are gates on Phase 3, not suggestions, because each one is a place where the obvious implementation violates an invariant or contradicts a fact I measured on the live catalog. Two of them correct the design authority itself (the parent work-log's composite-FK sentence, and the "reuse the publish path" premise). One is a new finding in the chain this pipeline is about to become the first caller of.

Everything else is advisory.

---

## Placement

### 1. Route group — Ruling 11 **confirmed**, with four amendments

**[BINDING] The group is `(statistics-submit)`**, at `/Users/cshenso/git/presby-platform/presby-wt-grants/src/app/(statistics-submit)/`. Public, platform palette, no session, enumeration-safe. Structurally `(password-reset)`, which is the right precedent for every detail below.

Amendments to Ruling 11:

- **[BINDING] No `layout.tsx`.** `(password-reset)` and `(email-verify)` both have none — they inherit the root layout, which already carries `metadata.robots = { index: false, follow: false }`, and `src/app/robots.ts` disallows everything but `/site/`. A group-level layout is the file where a future pipeline would reach for `<BrandTokens>`; not creating one removes the temptation and costs nothing.
- **[BINDING] Token in the query string, exact paths in the proxy allow-list.** `src/proxy.ts`'s `PUBLIC_PATHS` is a `Set` of exact pathnames; a token in the path segment would force a `startsWith` bypass of the `/site/` kind, which is a wider hole than this flow needs. Use `/file-statistics?token=…` (the `/reset-password?token=` precedent) and a second exact entry for the confirmation page. Two `Set` additions, no prefix bypass. **The URL carries the token and nothing else** — no slug, no org name, no year, no `callbackUrl`/`next` on either page (Adversarial #1 confirmed: the confirmation page accepts no redirect parameter at all).
- **Confirmation page: same group, separate path, no token, no data.** `/file-statistics/submitted` rendering a static "thank you, this link is now closed" — reachable by anyone, revealing nothing. Do not render the confirmation as a post-submit state of the token page: a back-button reload then re-consumes a spent token and has to be told apart from a genuinely spent one, which is an extra failure state to keep byte-identical for no gain.
- **[BINDING] The server action lives at `src/app/(statistics-submit)/actions.ts`** — group root, mirroring `src/app/(password-reset)/actions.ts`, which is exactly where `check:audit` walks.

**On `check:audit`, a correction to the work-log's framing.** Putting the action in a scanned file is necessary but *not sufficient*, and nobody should record "the tripwire passes" as evidence. `scripts/check-audit-coverage.mjs:35` matches only `/\bdb\s*\.\s*(insert|update|delete)\b/`. The submission will be `db.execute(sql\`select presby_submit_granted_return(…)\`)`, which the regex does not see — so the tripwire will pass whether or not an audit row is written. **[BINDING] Phase 3 must specify `recordAudit()` calls explicitly for grant-issued, grant-revoked and grant-submitted, and the work-log must record that coverage here is by review, not by tripwire.** No `// audit-exempt:` annotation is appropriate; nothing here is exempt.

*Suggestion (verified, not a gate):* extend `MUTATION_RE` to `/\bdb\s*\.\s*(insert|update|delete|execute)\b/`. I checked the tree — the only `actions.ts` under `src/app/` containing `.execute(` today is `src/app/(admin)/admin/2fa/actions.ts`, and it already calls `recordAudit`. The extension passes tree-wide right now, which makes this the cheapest moment in the project's life to close it. If tech-lead takes it, it is a one-line change plus a fixture case; if not, say so in the work-log so the next security review doesn't rediscover it.

*The submission audit row has no session.* Use the `{ userId: null, email }` override shape (`src/lib/audit.ts:304-323`, `RecordAuditInput.actor`) exactly as `requestPasswordReset` does — `email` from the grant's `issued_to_email`, grant id as `resourceId`, both org ids in `metadata`. Never put the raw token or its hash in `metadata`.

### 2. Directory placement

| Thing | Ruling |
|---|---|
| Table module | **[BINDING] Extend `src/lib/db/domain/returns.ts`; do not create `grants.ts`.** Its header already says so in writing (`src/lib/db/domain/returns.ts:22-25`: "`statisticsSubmissionGrants` (D16) belongs here too but ships in increment 6"), the grant→return FK makes them one unit, and it avoids touching `src/lib/db/domain/index.ts` at all — one fewer shared-file edit under Rule 16. If a second credential class ever appears, extract then. |
| Issuance / revocation logic | `src/lib/statistics-grants.ts` — **approved**, flat file, no new directory. `src/lib/presbytery.ts` is already 1013 lines across oversight + statistics + per-capita; a fourth concern does not belong in it. |
| Public submission logic | **[BINDING] Same file, but behind a hard-commented trust boundary**, and the public entry point's signature takes **no `personId` and no `organizationId`** — only `(tokenHash, payload, attestation)`. That signature *is* the boundary: a reviewer can see at a glance that the anonymous path cannot be handed an org id by a caller. If tech-lead prefers `statistics-grants-public.ts` as a second file, that is equally acceptable and marginally clearer; what is not acceptable is a shared helper that takes an optional `organizationId`. |
| Issuance UI | **Approved** as a fourth section of `src/app/(org)/o/[slug]/admin/reports/page.tsx` (294 lines, already three sections), with `issue-grant-form.tsx` / `grants-table.tsx` co-located. Issuance/revocation actions go in the **existing** `src/app/(org)/o/[slug]/admin/reports/actions.ts` — same permission family, same `revalidatePath`, and those *are* `db.insert`/`db.update` so the tripwire covers them for real. |
| SASR field metadata | **[BINDING] New flat file `src/lib/sasr-fields.ts`.** See below. |
| The 60-field form renderer | Co-located in `(statistics-submit)`, **not** `src/components/shared/` — one consumer today, and CLAUDE.md's rule is that feature-specific components stay with their route. The future congregation-side publish UI is the second consumer that promotes it. |

### 3. The 60-field form — **this pipeline builds the first spec-driven renderer**

Answering the question directly: **there is nothing to reuse.** `src/app/(org)/o/[slug]/admin/reports/statistics-form.tsx` is a hand-written form over 17 fields with labels and groups hard-coded in two `const` blocks (`:24-68`); it is the *presbytery-entered* core-fields form, not the SASR. `src/lib/presbytery.ts`'s `SasrAggregateInput` is the same 17.

The real form is 60 fields. I read the live spec: `sasr_form_versions.field_spec->'fields'` for key `'2024'` has **60 keys**, each `{type, min, max, sasr_line, comparable_to}` — **and no label**. And it cannot grow one later: `sasr_form_versions_field_spec_freeze` (trigger, `presby_freeze_used_field_spec`) rejects a `field_spec` UPDATE once any `statistical_returns` row references the key (F53). The moment this pipeline files its first 2024 return, the 2024 spec is frozen forever.

**[BINDING] Therefore:** field *set*, *types* and *bounds* are read from the database spec (server side, passed to the client form as a serializable prop); *labels, grouping and order* live in `src/lib/sasr-fields.ts` keyed by `form_version_key`; and a unit test asserts **key-set parity** between the labels map and the seeded `field_spec` for `'2024'`. Three hand-maintained copies of the field list (DB spec, `congregation_statistics` columns, TS labels) is one too many — `drizzle/0046` section 2's `DO` block already asserts the first two agree; the parity test closes the third leg. Do not hand-code 60 `<Input>`s, and do not extend `statistics-form.tsx`.

### 4. Server vs Client split

- **Public page** — Server Component. It resolves the token server-side (never in the client), and on success renders exactly one `'use client'` child: the form (`react-hook-form` + `zod` + `@hookform/resolvers`, the established pattern). The client component receives `{ fields, labels, year, orgName, token }` as props and imports nothing from `@/lib/db`.
- **Attestation** — `attested_by_name` / `attested_role` are plain columns with no CHECK. **[BINDING]** Zod bounds client-side *and* server-side (length ceiling, trim, reject control characters); `attested_role` should be a closed select (clerk of session / moderator / other-with-text), not free text, since it is the only machine-readable part of the attestation.
- **Mobile is a named Phase 3 deliverable, not a Phase 5 discovery.** Sixty numeric inputs at 360px handed to a volunteer. Grouped `<fieldset>`s, single column below `sm`, `inputMode="numeric"`, a sticky submit, and a save-nothing-on-failure story. CLAUDE.md's "Verify in a Browser" applies with unusual force: this is the one page in the platform whose user cannot call support, cannot sign in, and gets one attempt.
- **Issuance UI** — Server Component section; one client form; revoke via shadcn `AlertDialog` (Workflow Rule 2). No native dialogs, no hand-rolled button/table class strings (C2 is live tree-wide).

### 5. Dependencies — **none. Confirmed.**

Stopped at criterion 1 for every piece. Token: `randomBytes(32).toString("base64url")` + `createHash("sha256")` from `node:crypto`, byte-for-byte the `requestPasswordReset` precedent (`src/app/(password-reset)/actions.ts:16-17, 78-80`). **Do not use bcrypt here** — bcrypt is for low-entropy secrets; a 256-bit CSPRNG token wants a fast hash, and the existing `password_reset_tokens` precedent is sha256-hex. Form stack, toasts, rate limiter, email queue, audit: all present. `npm run check:deps-drift` unaffected; no `radix-ui` umbrella risk because no new primitive is needed (`Input`, `Label`, `Button`, `Select`, `AlertDialog`, `Card` all exist). If a primitive *is* missing, `npm run ui:add -- <name>` is the only path (DECISION-048).

---

## The write path (question 3) — ruled

### 5a. Which connection, and what sets `presby_current_org()`: **nothing does, and nothing may**

I read the live catalog rather than the migration text, and the fact that decides this is not in `drizzle/`:

```
rolname          | rolbypassrls
presby_app       | f
neondb_owner     | t          ← every table and every DEFINER function is owned by this role
```

`statistical_returns`, `publications` and `congregation_statistics` are all `relforcerowsecurity = t`, owned by `neondb_owner`, which holds `BYPASSRLS`. `FORCE ROW LEVEL SECURITY` binds the owner — but `BYPASSRLS` exempts the role ahead of it. So a `SECURITY DEFINER` function owned by `neondb_owner` is not filtered by `tenant_isolation` at all. That is the actual mechanism by which today's `presby_publish_sasr_snapshot()` writes a presbytery-owned `congregation_statistics` row from a congregation's session.

**[BINDING] Consequence: the anonymous path needs no org context whatsoever.** Phase 3 must **not** have the application `set_config('app.current_org_id', …)` before calling the submission function. Doing so would be `withOrgContext()` with the membership check deleted — the precise confused-deputy shape CLAUDE.md's "RLS enforces tenancy, not authorization" paragraph names, and the one increment 5 spent six loop-backs closing. The function derives both organization ids from the grant row it just authenticated, and the caller supplies only a token hash.

It also means the grant lookup and the claiming `UPDATE` **cannot** live in application code: the anonymous request has no org context, so `presby_app` cannot `select` the grant row under `tenant_isolation` at all. The whole operation is one DEFINER function. That is not a constraint I am imposing; it is the only thing that works.

### 5b. A second function, not a parameterization — and **[BINDING]** one extracted chain writer

`presby_submit_granted_return(p_token_hash text, p_payload jsonb, p_attested_by_name text, p_attested_role text)` — new, `SECURITY DEFINER`, `volatile`, `set search_path = public`, no org id and no council id in the signature. Parameterizing the existing function is rejected: its confused-deputy safety rests on deriving the org from context and accepting *no* identity claim, and an authorization branch keyed on a token would put a credential check inside a function whose every other caller has a session.

But "internally reuse the publish path" **cannot mean "call `presby_publish_sasr_snapshot()`"**, and this is the design-authority correction. I read the built function (`drizzle/0047:1393-1400`): it inserts `attested_by_name, attested_role` as **literal `null`**, deliberately, with a comment explaining that accepting an attester name as a parameter would be a caller-supplied identity claim. Delegating to it would produce a return with null attestation — discarding the one thing this entire flow exists to capture, and the very columns F57 says this pipeline is the first to populate.

Duplicating the three inserts is also rejected: F39's non-drift argument for `congregation_statistics.published_at`/`minute_reference` is *literally* "both rows are written by ONE DEFINER function in ONE transaction." A second copy of the ~60-column projection insert falsifies the premise the shipped design rests on.

**[BINDING] So `drizzle/0049` extracts the chain into one internal writer** — call it `presby_write_return_publication_chain(p_org, p_recipient, p_report_year, p_form_version, p_payload jsonb, p_reconciled, p_attested_by_name, p_attested_role, p_authorized_by, p_minute_reference) returns uuid` — which performs the three inserts and is the **single** site that arms `presby.publication_write_active`. Both entry points become thin:

- `presby_publish_sasr_snapshot()` is re-created (same name, same ~60-parameter signature) in `0049`, keeping its own validation and its `jsonb_build_object` payload assembly, then calling the helper with `null, null` for attestation. Its external contract does not move. **There is no live caller to break** — I grepped `src/`: the only references are comments and `src/lib/dev-docs.ts` prose. This is the cheapest week this refactor will ever be.
- `presby_submit_granted_return()` authenticates the grant, claims it, and calls the helper with the verified attestation.

The helper gets **no `EXECUTE` grant to `presby_app`** — `revoke all … from public` and nothing else. Inner calls from the two DEFINER wrappers check `EXECUTE` against `neondb_owner`, so containment is free.

*Fix-forward, not in-place.* `0049` re-creates `presby_publish_sasr_snapshot()` with `create or replace`; do **not** edit `drizzle/0047` from this branch. `0047` is merged and applied to `development`, three worktrees may be reading it, and a replay applies `0047` then `0049` in order with the same end state. The header comment in `0049` must say it supersedes `0047` section 7's body.

*One implementation cost, named so it isn't a surprise:* the helper takes `payload jsonb` and the projection insert must extract typed values from it rather than from 60 `p_*` parameters. That is safe precisely because `drizzle/0046` section 2's `DO` block already asserts the 2024 `field_spec` key set equals the typed `congregation_statistics` column set, and `presby_enforce_sasr_field_spec()` has validated types and bounds on the return insert before the projection insert runs. If tech-lead finds a cheaper shape that still yields exactly one chain writer and exactly one arming site, take it — the property is binding, the parameter list is not.

### 5c. The atomic claim (question 4) — **approved, and free**

`update statistics_submission_grants set submitted_at = now(), return_id = v_return_id where id = v_grant_id and submitted_at is null and revoked_at is null and expires_at > now() returning id` — `mirroring consumeResetToken`. Because the claim and the chain are both inside `presby_submit_granted_return()`, they are in one transaction by construction; there is no second connection and no window. **[BINDING] Claim first, write second**, and `raise` (rolling the whole thing back) if the `UPDATE` returns zero rows — a double-click, a two-tab race and a back-button resubmit all lose the claim before any artifact exists. The `returning` is the concurrency control; do not precede it with a `select … for update` "check", which is where this pattern usually grows a TOCTOU.

### 5d. The affiliation instant (Adversarial #6) — the invariant constraint for tech-lead

I am not ruling the instant. I am constraining it, and I am narrowing the question from three precedents to two, plus reporting a conflict that already exists in the chain.

**The three-way conflict is really two-way.** `statistical_returns_about_org` no-ops for submitted rows — I read the live function body: `if new.provenance <> 'imported' then return new; end if;`. And `statistical_returns_submitted_is_self` forces `about_org_id = organization_id` for submitted. So the report-year instant on the *artifact* is not in play. Two remain: the grant's frozen `organization_id` (issuance instant) and `presby_affiliation_parent_as_of(org, current_date)` (publication instant).

**[BINDING] constraints on whatever Phase 3 rules:**

1. **`publications.recipient_org_id` is resolved through the affiliation history at write time, never from the grant row and never from `organizations.parent_id`.** This is not open — it is D19, the column comment in `drizzle/0047:123-127`, and DECISION-135's no-caller-supplied-council-id discipline. The grant's `organization_id` is *provenance of issuance*, not *authority to receive*.
2. **No stored id is ever treated as standing.** Two Hierarchies: authority comes from the affiliation history, which is why `presby_transfer_affiliation()` exists at all. A grant issued by a presbytery that no longer has the congregation is a lapsed credential, and my recommendation (tech-lead's call) is that the function re-verifies `presby_affiliation_parent_as_of(about_org, current_date) = grant.organization_id` at claim time and refuses under the uniform failure literal if it disagrees — which makes the two instants either agree or the grant is dead, dissolving the conflict without arbitrating it.
3. **Whatever instant governs issuance must be the same instant re-verified at submission.** Two different instants across the two halves of one credential is a bug generator.

**A new finding, which I recommend the orchestrator number F80.** The chain's third insert enforces a *different* instant from its second, and the grant flow is the population most likely to hit it. Measured on the live catalog:

```
congregation_statistics_about_org | presby_check_about_org_affiliated | args: about_org_id\000year\000
```

With a year column supplied, that trigger requires `presby_org_affiliated(congregation, presbytery, Jan-1-of-report_year)` **or** `Dec-31-of-report_year`. Meanwhile the publication's recipient is resolved at `current_date`. For a congregation that transferred presbyteries *after* the report year and then files late — a late filer with no account, i.e. exactly D16's population — `presby_publish_sasr_snapshot()` computes the new presbytery as recipient, writes the return and the publication, and is then refused by the projection's about-org trigger with a uniform denial. The chain aborts. This is latent in the shipped increment-5 code, not introduced here; this pipeline will simply be the first to reach it. **[BINDING] Phase 3 must state which of the three checks moves and why, and Phase 4 must cover it with a fixture** (the Tidewater/Coastal Plain transfer fixture from `scripts/test-rls.sql` is already the right shape).

---

## Invariants Touched

**Permissions vs Flags — respected, and extended by one mechanism that must be named.** `statistics.manage` for issuance/revocation (resolver-based, tenant axis, no `FEATURES.*`); new flag `statistics.submission_grants` seeded **off**, gating both surfaces; bare `isFlagEnabled()` (fail-closed) is correct — this gates a write, not a sign-in, so it stays out of `src/lib/auth/`'s named fail-open wrappers (DECISION-026). The issuance section is a triple gate: `org_portal.reports` (page) **and** `statistics.submission_grants` (feature) **and** `statistics.manage` (permission). **[BINDING] The token is a third thing and must be named as such:** a *credential* — a one-time, single-purpose, expiring capability. It is not a permission and must never be mapped into `FEATURES.*`, into a session claim, or into the permission resolver. This is the substance of DECISION-147 below.

**Two Hierarchies Intersect Nowhere — respected, and this is the invariant the issuance path stresses.** No platform predicate (`is_platform_admin`, `canAccessAdmin`, any `FEATURES.*`) may appear in any authority check on this path. Note that `resolveMemberCongregation()` (`src/lib/presbytery.ts:131-151`) answers "is X my member congregation?" with `organizations.parentId = organizationId` — the derived cache, not the history. **[BINDING] That is acceptable as the UI picker's filter and unacceptable as the authority check.** The check that matters is in the database at write time, through the affiliation history. This is exactly the coupling the parent pipeline's Phase 2 Note 3 flagged: if the cache and the history disagree for one row, the presbytery's UI offers a congregation the database then refuses.

**Isolation Is a Database Property — respected, and the anonymous path is the sharpest test of it.** No new policy (§17's two-named-policies rule untouched, DECISION-112's refusal of a third stands). Every cross-boundary act is function-mediated. The application connection stays `presby_app`, `NOBYPASSRLS`, with no org context on the anonymous path — see 5a.

**F55 / DECISION-141, creation guarded as strongly as mutation — respected via 5b**, and extended to the grants table itself (question 6's last clause). **[BINDING] `statistics_submission_grants` guard shape:**

- **INSERT** (issuance): ordinary tenant DML under `tenant_isolation` is admissible — `organization_id` is the caller's own presbytery, no cross-council write. But the row *names another organization* in `about_org_id`, so the about-org relationship is a **trigger**, not an app check. Reuse `presby_check_about_org_affiliated` via `tg_argv` rather than writing a fourth affiliation checker; pass `about_org_id` with an **empty** year argument so it resolves at `current_date` (consistent with the publication instant — and see F80 above before finalizing).
- **UPDATE**: a freeze trigger in `presby_freeze_publication()`'s shape permitting exactly **two** transitions and rejecting everything else, on every connection: (a) `revoked_at` null → set, nothing else moving (the presbytery's own revocation, ordinary tenant DML); (b) `submitted_at`/`return_id` null → set, nothing else moving, **and only when a new, distinct GUC `presby.grant_claim_active` is armed** — armed once inside `presby_submit_granted_return()`. Do **not** reuse `presby.publication_write_active`: claiming a credential and writing an artifact are two claims about two subsystems, which is the identifier table's no-reuse case (F56's reasoning). And per QA-2's correction to F56, remember the GUC binds the *owner* path only — the tenant half is closed by narrowing `presby_app`'s UPDATE grant to `revoked_at` alone (column-level). **A marker is not a privilege.**
- **DELETE**: revoke from `presby_app`; **no DELETE guard trigger** — see question 7.

**Composite Tenant Keys (F2) — respected, and the design authority has this wrong in one place.** The parent work-log's Phase 2 (`docs/work-log/2026-09-24-lifecycle-affiliation-returns.md:270`) says "`statistics_submission_grants.return_id` likewise" composite, without naming the columns. **[BINDING] The naive reading is wrong in exactly the way `drizzle/0047:50-60` already caught for `congregation_statistics`:** the grant's `organization_id` is the **presbytery**; `statistical_returns.organization_id` for a submitted row is the **congregation**. So

```sql
-- WRONG — rejects every row it was written to protect:
foreign key (return_id, organization_id) references statistical_returns (id, organization_id)
-- CORRECT — the column that equals the return's owner is about_org_id:
foreign key (return_id, about_org_id)   references statistical_returns (id, organization_id)
```

This preserves the property that matters: a grant cannot claim a return filed by a *different* congregation. `organization_id` and `about_org_id` themselves stay **plain** FKs to `organizations` (the §17 structural exception), both `on delete cascade` — see question 7.

**F40 (a constraint as a cross-tenant existence oracle) — evaluated, and clean, but say so out loud.** The partial unique `(organization_id, about_org_id, report_year) where revoked_at is null and submitted_at is null` can only collide with the caller's **own** presbytery's row, so it is not an oracle. `token_hash unique` *is* global across tenants, but a collision requires guessing a 256-bit CSPRNG value, so it is not an exploitable oracle either. Record both in the work-log so the security pass doesn't re-raise them. *Note the index deliberately permits two different presbyteries to hold live grants for the same congregation-year* — the claim-time affiliation re-verification (5d) is what kills the stale one.

**The Brand Is a Cascade Override (DECISION-047) — respected, and the tripwire needs no edit.** `scripts/check-brand-scope.mjs:40-45` is explicit: "A route group added later is un-brandable by default until someone edits this array." E1 forbids `<BrandTokens>` outside `EMITTERS`; E3 forbids any `<style` or `dangerouslySetInnerHTML` under `src/` outside `src/components/brand/`; C1 forbids `*-brand` utilities outside `(org)`/`(public)`. **[BINDING] `(statistics-submit)` must not be added to `EMITTERS`, must not import `read-org-brand.ts`, and must not use a `*-brand` utility.** Flag-off, invalid, expired, revoked and spent all render identical platform-chrome copy.

**Un-brandable is not logo-free, and here that is load-bearing for trust** — a volunteer asked to type their congregation's membership numbers into an unfamiliar URL needs to see the congregation's name. `src/components/brand/org-mark.tsx` takes no `tone`/brand prop and paints on a fixed literal near-white plate by construction (G7), so it is legal in this group. **[BINDING]** If the logo ships, the org id passed to `getBlobStore().resolve()` comes from the grant row, never from the request — `resolve()` uses `withTrustedOrgContext()` and trusts its caller (`src/lib/storage/blob-store.ts:228-237`). My recommendation: **ship v1 with the organization's name only**, and add the logo when someone asks; the name is what establishes trust, and the blob read is a second anonymous data path to justify to the security pass for a marginal gain.

**Enumeration safety (DECISION-040/047) — respected, with one concrete rule.** "Identical copy at identical response time" cannot be achieved by asserting it. **[BINDING] Every failure state must traverse the same code path with the same number of database round-trips.** Concretely: do **not** check the flag before the token lookup and early-return — a flag-off response would then be measurably faster than a revoked-grant response, and flag state becomes an oracle. Hash the supplied token, do the single indexed lookup, evaluate flag + expiry + revocation + spent-ness together, and return one literal. A DB failure returns the *same* literal. The DEFINER function should likewise raise one uniform message for every refusal, in `presby_deny_about_org_write()`'s cause-blind style.

**Rate limiting — [BINDING] key the public endpoint by IP, not by token.** `checkRateLimit` keyed on `stats_submit:${ip}` (the `pwreset_req:${ip}` precedent). A token-keyed limit lets anyone holding or guessing at a link lock a real congregation out of its one filing window. Issuance is separately limited per issuing org. `checkRateLimit` writes its own `RATE_LIMIT_BLOCKED` audit row from inside `src/lib/rate-limit.ts` — per that file's header (`:17-23`), do **not** add an audit-exempt annotation at the call site.

**No Real Data — unchanged.** Fixtures use `example.invalid`; `scripts/seed-dev.sql` gains one appended block per Rule 16. The raw token never touches a log, a DB column, or an audit row.

*Named residual for the security pass, with precedent:* the emailed link containing the raw token is rendered into `email_queue`'s stored HTML, so the credential sits at rest in a table the platform connection can read. `password_reset` has done exactly this since the starter. Consistent and accepted — but state it in the work-log rather than letting the security pass discover it.

**The Edge Gate Cannot Reach the Database — respected.** The `src/proxy.ts` change is two string additions to a `Set`. No import, no claim, no DB.

**Post-Login Landing / the `(org)` contract — untouched.** `(statistics-submit)` has no session and never redirects to `/launch`. **[BINDING] No `loading.tsx`** on either new segment: the token page's job on every failure path is to render a terminal state, and a Suspense boundary flushes a 200 before the page resolves (measured 2026-08-18).

---

## Notes

### Question 7 — `deletable_until`: **no. Fixture-deletable by cascade.**

`deletable_until` is a column on `organizations` only; `presby_guard_organizations_delete()` (`drizzle/0044:1655-1690`) validates the window and then **arms the child guards' GUCs** so the cascade Postgres fires next is pre-authorized. **[BINDING] Make both `organization_id` and `about_org_id` `on delete cascade`** — the same reason `organization_affiliations.subject_org_id` is (`0044:1062`) — and the grant rows disappear with either fixture org, with no teardown-site change.

This is also why I ruled **no DELETE guard** above. Adding one would force `0049` to `create or replace presby_guard_organizations_delete()` purely to add a third `set_config` line, duplicating a function body across two migrations. The asset being protected is an expiring credential, not a permanent record; a submitted grant's audit value is already durable in `audit_events` and in the immutable return itself. **Record it as a bounded, deliberate residual** — that sentence in the work-log is what stops the next reviewer treating it as an oversight.

### Phase 3 checklist

1. **Rule F80 (5d) before database-admin writes anything.** It is the one item that can invalidate the function's shape.
2. **The extraction in 5b is the riskiest change in the pipeline** and it touches a function outside this feature's blast radius. It needs its own `test-rls.sql` section proving the rewritten `presby_publish_sasr_snapshot()` still produces byte-identical rows, plus the F39 equality assertion (`congregation_statistics.published_at = publications.published_at`) re-run.
3. **Name the `test-rls.sql` sections owed** (appended as one delimited block per Rule 16): the grant-table grant shape; the UPDATE freeze rejecting every transition but the two; a claim proven non-repeatable (second call refused); the `publication_write_active`-disarmed direct-INSERT refusal still holding after the extraction; the about-org trigger on issuance; the uniform-literal probe.
4. **The `about_org_id` composite-FK correction (5b/Invariants) goes into `docs/schema-design-2.md` §6** in the same pass — §6's sketch is what a future reader will build from.
5. **Confirm the five orchestrator working assumptions as design inputs.** All five are architecturally sound; I add only that assumption 3 (restrict to `unmanaged`/`invited`) is a *policy* choice, not a structural necessity — if a managed congregation ever self-files against an outstanding grant, both writes go through the same chain and the second correctly derives `supersedes_id` from the first, so the outcome is a proper supersession rather than the silent `published_at` coalesce Adversarial #7 feared. Worth recording, because it means assumption 3 can be relaxed later without reopening the data model.
6. **Two `docs/decisions.md` / `CLAUDE.md` follow-ups for the orchestrator at Phase 6** (not edited on this branch): add `(statistics-submit)` to the enumerated un-brandable groups under **Key Invariants → The Brand Is a Cascade Override**, and add the group's line to the architect agent's route-group rules. Also add an entry to `src/lib/dev-docs.ts`'s `INVARIANTS` array for the credential mechanism, marked `trigger` — a new invariant absent from that array is a paper invariant by default.
7. **Out of scope, confirmed:** filing-history page (assumption 4), `presby_withdraw_publication()` UI, D13 import, push notification, post-issuance email correction.

### Proposed decision

**DECISION-147: A token-bearing submission grant is a *credential* — a third access mechanism alongside permissions and flags — and it authorizes exactly one write, inside one `SECURITY DEFINER` function, with no org context set by the caller.** The public submission page is its own un-brandable route group, `(statistics-submit)`, on the `(password-reset)` pattern: platform palette, no session, no `FEATURES.*` gate, exact paths in `src/proxy.ts`'s public allow-list, token in the query string, one uniform response for every failure state including flag-off. A credential is never mapped into `FEATURES.*`, into a session claim, or into the permission resolver; it names its own subject, so the function derives both organization ids from the grant row and the application sets no org GUC — the tenant tables are owned by a `BYPASSRLS` role, so a DEFINER function needs none, and setting one would be `withOrgContext()` with the membership check deleted. The return → publication → projection chain keeps **one** writer and **one** `presby.publication_write_active` arming site: `drizzle/0049` extracts the three inserts into an internal, ungranted `presby_write_return_publication_chain()`, behind which both `presby_publish_sasr_snapshot()` (attestation null, as today) and the new `presby_submit_granted_return()` (attestation verified from the form, the first non-null values F57 anticipated) become thin callers — because delegating to the existing function would discard the attestation it deliberately refuses to accept, and duplicating the inserts would falsify F39's one-function-one-transaction non-drift premise. The grant row is claimed by an atomic guarded `UPDATE … RETURNING` inside that same transaction; `return_id` is composite against `(about_org_id)`, not `(organization_id)`, because the grant is owned by the presbytery and the return by the congregation — the same correction `drizzle/0047` already made for `congregation_statistics.publication_id`. *(2026-09-25, architect Phase 2, `docs/work-log/2026-09-25-submission-grants.md`.)*

### Proposed finding

**F80 — the publication chain enforces two different affiliation instants, and the late-filing population is the one that hits the gap.** `publications.recipient_org_id` is resolved at `current_date` via `presby_affiliation_parent_as_of()`, while `congregation_statistics_about_org` (`presby_check_about_org_affiliated`, `tg_argv = {about_org_id, year}`) requires affiliation at either endpoint of the **report year**. A congregation that changed presbytery after the report year and then files late has its return and publication written and its projection refused, aborting the chain. Latent in increment 5 as shipped (no application caller exists yet); increment 6 is the first path likely to reach it, since filing without an account is disproportionately late filing. Measured against the live catalog on `pipeline-submission-grants`, 2026-09-25. Number subject to the orchestrator.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-09-25 |

**Handoff:** to **tech-lead** (Phase 3). Carry Phase 1's Gaps, Open Questions and the five orchestrator working assumptions forward verbatim; they are inputs to the design, not resolved by this section. Tech-lead owes rulings on: **F80 first** (it can invalidate the function shape), the affiliation instant within the three constraints in 5d, the two permitted UPDATE transitions on the grants table, the `managed`-status enforcement point, and the mobile plan for a 60-field form. Everything marked **[BINDING]** is a gate; everything else is advisory. Implementer will span schema + server + client — my read is that `drizzle/0049` plus the two functions is a **database-admin** batch and the route group plus the issuance section is an **api-developer** → **ux-developer** pair, rather than one `full-stack-developer`, but that is tech-lead's call.



### Orchestrator notes (2026-09-25)

- **F80** (the two affiliation instants in the chain) is this pipeline's to rule and fix: `drizzle/0049` re-creates `presby_publish_sasr_snapshot()` anyway. The lifecycle pipeline's concurrent third external round (main tree, `docs/schema-design-2.md` §2h, F60–F64) is told of it and does not touch the instant.
- **F60 applies to every function this pipeline creates or re-creates:** `SET search_path = public, pg_temp` — `pg_temp` explicitly last — on every `SECURITY DEFINER` function in `drizzle/0049`, including the re-created `presby_publish_sasr_snapshot()`. The security pipeline sweeps 0001–0042; the lifecycle round fixes 0043–0047 in place; at integration 0049's re-created body must carry the clause.
- The `check:audit` `MUTATION_RE` extension (`execute`) is accepted as a suggestion for tech-lead to take or decline in writing.

---


# Phase 3 — Technical Design (tech-lead)

## Summary

We are building the write path and the two surfaces Phase 2 placed but did
not design: a presbytery-side "issue a submission grant" section on
`/o/[slug]/admin/reports`, and a public, session-less, enumeration-safe
`(statistics-submit)` route group where the emailed link's holder files one
SASR return with no account. The grant is a *credential* (DECISION-147), not
a permission and not a flag — a one-time, single-purpose, expiring capability
that authorizes exactly one write, inside one `SECURITY DEFINER` function,
with no org context ever set by the caller. This closes D16: a congregation
with no member and no login can still discharge its constitutional reporting
duty, and the presbytery that would otherwise have to phone every unmanaged
church for its numbers gets a self-service issuance flow instead.

Three rulings gate everything below. **F80** (two affiliation instants in the
shipped chain) is real but narrower than Phase 2 feared: the year-endpoint
collision check already living in `presby_publish_sasr_snapshot()` is moved,
verbatim, into the new shared chain writer, so both callers get the same
protection from one piece of code — no duplication, no drift. The **grant's
own affiliation instant** is claim-time re-verification against the
affiliation history (never the grant's own stored `organization_id`, which is
provenance of issuance, not authority to receive) — a stale grant is a dead
credential, refused under the same uniform literal as an expired or revoked
one. **`managed` exclusion** is enforced at issuance, in the database, by a
trigger — not the UI picker — because CLAUDE.md's own rule is that the check
that matters is at write time; if a congregation becomes `managed` after
issuance, the outstanding grant is still honored at claim time (a second
self-filed return, should one arrive first, resolves through the *existing*
supersession chain, not a special case this pipeline has to build).

## Permissions & Flags

- **Issuance / revocation:** `statistics.manage` (existing key, `drizzle/
  0038:714`, tier 2, module `presbytery`, default-bound to
  `presbytery_stated_clerk`). No new permission — Phase 1's own recommendation
  and Phase 2's confirmation both hold: issuing a grant is an alternate
  mechanism for the same duty `setCongregationStatistics()` already gates.
- **Public submission endpoint:** no permission, no `FEATURES.*` gate. The
  token is the credential (Ruling 11 / DECISION-147). This is stated as an
  invariant, not an omission: never map a grant token into `FEATURES.*`, a
  session claim, or the permission resolver.
- **New flag:** `statistics.submission_grants`, seeded **off**, gating both
  the issuance section (a third, independent gate alongside the existing
  `org_portal.reports` page flag and the `statistics.manage` permission) and
  the public route. Checked with the bare `isFlagEnabled()` — fail-closed is
  correct here (this gates a write, not a sign-in path, so it stays out of
  `src/lib/auth/`'s DECISION-026 fail-open wrappers).
- **Default role bindings:** none change. `presbytery_stated_clerk` already
  carries `statistics.manage`; no seed-binding edit is needed.

## API Contract

### `src/lib/statistics-grants.ts` — issuance / revocation / listing (session, tenant DML)

```ts
export type StatisticsGrantResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string };

export interface IssueStatisticsGrantInput {
  aboutOrgId: string;
  reportYear: number;
  issuedToName: string;
  issuedToEmail: string;
  /** Optional; default 45, clamped [1, 180]. */
  expiresInDays?: number;
}

export async function issueStatisticsGrant(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: IssueStatisticsGrantInput,
): Promise<StatisticsGrantResult<{ id: string; expiresAt: string }>>;

export async function revokeStatisticsGrant(
  viewerPersonId: string,
  organizationId: string,
  grantId: string,
): Promise<StatisticsGrantResult<{ id: string }>>;

export interface StatisticsGrantRow {
  id: string;
  aboutOrgId: string;
  aboutOrgName: string;
  reportYear: number;
  issuedToName: string;
  issuedToEmail: string;
  issuedAt: string;
  expiresAt: string;
  submittedAt: string | null;
  returnId: string | null;
  revokedAt: string | null;
  status: "issued" | "expired" | "revoked" | "submitted";
}

export async function listStatisticsGrants(
  viewerPersonId: string,
  organizationId: string,
): Promise<StatisticsGrantResult<StatisticsGrantRow[]>>;
```

Shape and internals mirror `src/lib/presbytery.ts` exactly: one
`withOrgContext()` transaction per function, a local (module-private, not
shared/exported) `hasPermission()` copy calling `presby_has_permission()`
gated on `STATISTICS_MANAGE` first in every function body, and a local
`resolveMemberCongregation()` copy — the SAME parent-path re-resolution
(`organizations.parentId = organizationId and organizationType =
'congregation'`) used as the picker's *filter*, never as authority (the
database trigger is authority — see Data Model). Duplicated rather than
imported from `presbytery.ts` because neither helper is exported there today
and the file already documents this as its own established per-module
pattern (`person-sensitive.ts`/`credentials.ts` each keep their own copy too).

`issueStatisticsGrant()` internals: permission gate → `resolveMemberCongregation`
(returns `invalid_target` if the congregation isn't this presbytery's own) →
mint `rawToken = randomBytes(32).toString("base64url")`,
`tokenHash = sha256Hex(rawToken)` (byte-for-byte the `requestPasswordReset`
precedent, `node:crypto`, never bcrypt) → `tx.insert(statisticsSubmissionGrants)`
(the partial-unique violation on `(organizationId, aboutOrgId, reportYear)`
is caught and mapped to `invalid_input: "A grant is already outstanding for
this congregation and year — revoke it first."`, never surfaced as a raw
constraint name) → `enqueueEmail()` with the link
`${baseUrl}/file-statistics?token=${rawToken}` → return `{ id, expiresAt }`.
**The raw token never leaves this function's scope** — not returned to the
caller, never logged, never in `metadata`.

`revokeStatisticsGrant()` first `select`s the row (tenant-scoped) to
distinguish, for the UI, **not found** vs. **already submitted** (return
`invalid_input: "This grant was already used to file a return on <date>."`)
vs. **already revoked** (`invalid_input: "This grant was already revoked."`)
before attempting the `update … set revokedAt = now() where id = … and
submittedAt is null and revokedAt is null returning id`.

### `src/app/(org)/o/[slug]/admin/reports/actions.ts` — additions (existing file)

```ts
export async function issueStatisticsGrantAction(
  slug: string,
  input: IssueStatisticsGrantInput,
): Promise<ActionResult<{ id: string }>>;

export async function revokeStatisticsGrantAction(
  slug: string,
  grantId: string,
): Promise<ActionResult<{ id: string }>>;
```

Same `resolveActingIdentity(slug)` plumbing as every other action in this
file; on `ok`, `recordAudit({ action: STATISTICS_GRANT_ISSUED | STATISTICS_
GRANT_REVOKED, resourceType: "statistics_submission_grants", resourceId:
result.data.id, metadata: { organizationId, aboutOrgId, reportYear } })`
(never the token or its hash), then `revalidatePath`.

### `src/lib/statistics-grants.ts` — the public submission boundary (no session, no org context)

```ts
export async function submitStatisticsGrant(
  rawToken: string,
  payload: Record<string, unknown>,
  attestedByName: string,
  attestedRole: string,
): Promise<
  | { kind: "ok" }
  | { kind: "invalid" }            // one bucket: not found, expired, revoked,
                                    // already submitted, stale affiliation,
                                    // flag off, or a genuine DB failure
  | { kind: "invalid_input"; message: string }  // form validation, once the
                                    // token is proven live
>;
```

**Signature is the trust boundary** (Phase 2 Ruling): no `personId`, no
`organizationId`, ever. Internals:

1. `tokenHash = sha256Hex(rawToken)`.
2. `flagOn = await isFlagEnabled("statistics.submission_grants")`.
3. If **not** `flagOn`: run `db.query.statisticsSubmissionGrants.findFirst({
   where: eq(tokenHash, …) })` — a real, side-effect-free, identically-costed
   indexed lookup — and return `{ kind: "invalid" }` regardless of what it
   finds. This is the deliberate mechanism that keeps a flag-off response
   from being measurably cheaper than a live-token response (Phase 2's
   enumeration-safety rule), without teaching the SQL layer about flags —
   flags stay a pure TS/`feature_flags` concept, never passed into a
   `SECURITY DEFINER` function parameter.
4. If `flagOn`: `zod`-validate `payload`/`attestedByName`/`attestedRole`
   client-shape first (trim, length ceilings, printable-only, closed enum for
   role), then call `db.execute(sql`select presby_submit_granted_return(${tokenHash}, ${JSON.stringify(payload)}::jsonb, ${attestedByName}, ${attestedRole})`)`.
5. Map the SQL exception: `errcode = 'insufficient_privilege'` and message
   prefix `'presby_submit_granted_return: grant not usable'` → `{ kind:
   "invalid" }`. Any other error (attestation/value-range/about-org-year
   rejection) → `{ kind: "invalid_input", message: "Some entries could not
   be saved — check the highlighted fields and try again." }` (a generic
   *category* message; the SQL exception text itself is never surfaced to
   the browser — logged server-side only). A genuine thrown/network/DB
   error → `{ kind: "invalid" }`, same bucket as an invalid token, per
   Phase 1's "nothing was saved, try the link again" rule.

### `src/app/(statistics-submit)/actions.ts` — the server action (new file, group root, `check:audit` walks here)

```ts
export async function submitGrantedReturnAction(input: {
  token: string;
  payload: Record<string, number | boolean | undefined>;
  attestedByName: string;
  attestedRole: "clerk_of_session" | "moderator" | "other";
  attestedRoleOther?: string;
}): Promise<ActionResult>;
```

Order: `headers()` → `getRequestIp()` → `checkRateLimit("stats_submit:" + ip,
{ max: 10, windowSeconds: 3600 }, { userId: null, actor: ip ?? "unknown",
reason: "statistics_grant_submit" })` (IP-keyed, never token-keyed — a
token-keyed limit lets a prober lock out the one real filer) → collapse
`attestedRole`/`attestedRoleOther` into one string (`"other: <text>"` when
`other`) → call `submitStatisticsGrant()` → on `"ok"`, three `recordAudit()`
calls (see Audit Events) using the actor-override shape `{ userId: null,
email: <issuedToEmail from... }` — **the action has no grant row to read the
email from until the SQL call succeeds**, so `recordAudit`'s `metadata`
carries `{ aboutOrgId: null-until-resolved }`; concretely, `presby_
submit_granted_return()` returns the new `returnId`, and the action performs
one follow-up `select organizationId, aboutOrgId, issuedToEmail from
statisticsSubmissionGrants where returnId = …` (self-scoped, harmless: the
row now exists and is already spent) purely to populate the audit
`metadata`/`actor.email` — never to re-derive authority. On `"invalid"` or
`"invalid_input"`, return the mapped `ActionResult` untouched by rate-limit
concerns; **every returned shape is `{ ok: false, error: <one of two fixed
strings> }`**, byte-identical whichever branch produced it.

### `src/app/(statistics-submit)/file-statistics/page.tsx` (Server Component)

`params: { searchParams: Promise<{ token?: string }> }`. Resolves the token
**server-side only** (never passed to a client component beyond the opaque
string needed to re-submit it) via a **read-only** preview lookup — not
`presby_submit_granted_return()` itself, which is a write. A second, small,
`SECURITY DEFINER`, `language sql stable` function,
`presby_preview_granted_return(p_token_hash text)`, returns `(about_org_name
text, report_year integer, form_version_key text)` for a live (unexpired,
unrevoked, unsubmitted) grant and **null row** for everything else — same
uniform-literal discipline, one indexed lookup, no cross-tenant leak (it
returns only the congregation's own public name, already public per the org
tree). On no row: render the generic "this link is no longer active" page
(same copy, same platform chrome, no distinguishing state). On a row: render
the client form.

## Data Model

### `statistics_submission_grants` — new table, `drizzle/0049_presby_submission_grants.sql`

```sql
create table if not exists statistics_submission_grants (
  id uuid primary key default gen_random_uuid(),
  -- The ISSUING PRESBYTERY. Tenant scope for the policy below.
  organization_id uuid not null references organizations(id) on delete cascade,
  -- The CONGREGATION being asked. Plain FK (section-17 structural exception —
  -- organizations carries no tenant scope of its own; it is the public tree).
  about_org_id uuid not null references organizations(id) on delete cascade,
  report_year integer not null,
  -- sha256 hex of the raw CSPRNG token. NEVER the token itself.
  token_hash text not null,
  issued_to_name text not null,
  issued_to_email text not null,
  -- The issuing admin. NOT the Ruling-A4 gap: this row is written by
  -- ordinary tenant DML under a real session (issueStatisticsGrant()),
  -- never by a SECURITY DEFINER function serving an anonymous caller, so
  -- there is no caller-supplied-identity concern here.
  issued_by uuid not null references users(id),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- THE CLAIM. submitted_at moves alone first (the atomic claim); return_id
  -- follows in a second, sanctioned UPDATE once the chain writer has run —
  -- see the guard trigger below for why this is a two-step, not two-column,
  -- transition, and why that is what makes "claim first, write second" and
  -- "one indexed UPDATE...RETURNING is the concurrency control" both true
  -- at once.
  submitted_at timestamptz,
  return_id uuid,
  -- The presbytery's own revocation. Ordinary tenant DML; never re-cleared.
  revoked_at timestamptz,
  constraint statistics_submission_grants_id_org_key unique (id, organization_id),
  constraint statistics_submission_grants_token_hash_key unique (token_hash),
  constraint statistics_submission_grants_token_hash_shape
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint statistics_submission_grants_report_year_range
    check (report_year between 1900 and 2100),
  constraint statistics_submission_grants_expiry_shape
    check (expires_at > issued_at),
  constraint statistics_submission_grants_name_shape
    check (char_length(btrim(issued_to_name)) between 1 and 255),
  constraint statistics_submission_grants_email_shape
    check (char_length(issued_to_email) between 3 and 320),
  -- ONE-DIRECTIONAL, not symmetric (F51's lesson applied from the start
  -- rather than corrected later): return_id implies submitted_at, but
  -- submitted_at does NOT require return_id — the mid-claim state (claimed,
  -- chain not yet written) is legal and transient, closed by the SAME
  -- transaction that opened it (see presby_submit_granted_return()).
  constraint statistics_submission_grants_claim_shape
    check (return_id is null or submitted_at is not null),
  -- The grant is owned by the presbytery; the return it claims is owned by
  -- the CONGREGATION (about_org_id) — the same correction drizzle/0047 made
  -- for congregation_statistics.publication_id. MATCH SIMPLE (default): a
  -- null return_id (every outstanding grant) is not checked at all.
  constraint statistics_submission_grants_return_fk
    foreign key (return_id, about_org_id)
    references statistical_returns (id, organization_id)
);

-- One LIVE grant per (presbytery, congregation, year). A revoked or spent
-- grant is not live and does not block a re-issue. Partial, so a table
-- constraint cannot express it (see F40 analysis below).
create unique index if not exists statistics_submission_grants_live_idx
  on statistics_submission_grants (organization_id, about_org_id, report_year)
  where revoked_at is null and submitted_at is null;

create index if not exists statistics_submission_grants_about_org_year_idx
  on statistics_submission_grants (about_org_id, report_year);
create index if not exists statistics_submission_grants_org_idx
  on statistics_submission_grants (organization_id);

alter table statistics_submission_grants enable row level security;
alter table statistics_submission_grants force row level security;

drop policy if exists tenant_isolation on statistics_submission_grants;
create policy tenant_isolation on statistics_submission_grants
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- Grant shape (F55/DECISION-141 extended; question 6). presby_platform is
-- narrowed the SAME way as publications, not left with its blanket 0009
-- grant: this table records authorization events, and a platform-shell
-- connection reading across every tenant should never be able to ISSUE one.
revoke all on statistics_submission_grants from presby_app, presby_platform;
grant select on statistics_submission_grants to presby_app, presby_platform;
grant insert on statistics_submission_grants to presby_app;
-- COLUMN-LEVEL. presby_app may revoke its own presbytery's grants and
-- nothing else — submitted_at/return_id are written ONLY inside
-- presby_submit_granted_return(), which runs as the owner (F44).
grant update (revoked_at) on statistics_submission_grants to presby_app;
-- No DELETE grant to either role, and no DELETE guard trigger (question 7):
-- both FKs are ON DELETE CASCADE, so an organization teardown (guarded
-- elsewhere, presby_guard_organizations_delete()) removes grant rows for
-- free, with no arming needed — there is no BEFORE DELETE trigger on this
-- table to block the cascade in the first place.
```

**F40 (existence-oracle) check, stated rather than re-litigated:** the
partial unique can only collide with the caller's own presbytery's row (not
an oracle); `token_hash unique` is global but a collision requires guessing a
256-bit CSPRNG value (not exploitable).

**Two INSERT-time triggers (issuance only — never fire on the anonymous
path, which only ever `UPDATE`s an existing row):**

```sql
-- Reuses the existing shared checker (drizzle/0045) rather than writing a
-- fifth affiliation trigger. Empty year arg -> current_date, matching the
-- issuance instant (today), which is a DIFFERENT instant from the
-- report-year check inside the chain writer below, deliberately: issuance
-- asks "is this my congregation today", submission asks "was this
-- congregation this presbytery's during the report year" (F80/DECISION-147).
create trigger statistics_submission_grants_about_org
  before insert on statistics_submission_grants
  for each row execute function presby_check_about_org_affiliated('about_org_id', '');

-- NEW, narrow, single-purpose. organizations carries no RLS (the public org
-- tree), so no DEFINER trick is needed to read platform_status.
create or replace function presby_check_grant_about_org_unmanaged()
returns trigger language plpgsql as $$
declare
  v_status text;
begin
  select platform_status into v_status from organizations where id = new.about_org_id;
  if v_status = 'managed' then
    raise exception
      'statistics_submission_grants: % already has an active account and self-files through its own portal; a submission grant is only for an unmanaged or invited congregation',
      new.about_org_id
      using errcode = 'invalid_parameter_value';
  end if;
  return new;
end $$;

revoke all on function presby_check_grant_about_org_unmanaged() from public;
revoke execute on function presby_check_grant_about_org_unmanaged() from presby_app, presby_platform;

create trigger statistics_submission_grants_unmanaged
  before insert on statistics_submission_grants
  for each row execute function presby_check_grant_about_org_unmanaged();
```

**The UPDATE guard (question 4/5) — three sanctioned transitions, not two,**
because the claim is genuinely two statements in one transaction (below):

1. **Revocation** — `revoked_at` null → set, nothing else moves, no GUC
   needed (ordinary tenant DML, grant-closed to `revoked_at` only anyway).
2. **The claim** — `submitted_at` null → set (`return_id` stays null),
   nothing else moves, only while `presby.grant_claim_active` is `'true'`.
3. **The stamp** — from a row with `submitted_at` already set and `return_id`
   still null: `return_id` null → set, nothing else moves (not even
   `submitted_at`, which must equal `old.submitted_at`), only while
   `presby.grant_claim_active` is `'true'`.

A row is terminal (no further UPDATE of any kind) once `revoked_at` or
`return_id` is non-null. `presby.grant_claim_active` is a **new, unshared**
GUC (F56's no-reuse rule: claiming a credential and writing an artifact are
two claims about two subsystems) — never `presby.publication_write_active`.

```sql
create or replace function presby_freeze_statistics_submission_grant()
returns trigger language plpgsql as $$
begin
  if old.revoked_at is not null then
    raise exception 'statistics_submission_grants %: already revoked at %; issue a new grant instead',
      old.id, old.revoked_at using errcode = 'check_violation';
  end if;
  if old.return_id is not null then
    raise exception 'statistics_submission_grants %: already claimed by return %; a spent grant is immutable',
      old.id, old.return_id using errcode = 'check_violation';
  end if;

  if old.submitted_at is not null then
    -- Only the stamp (transition 3) is legal from here.
    if new.return_id is null
       or new.submitted_at is distinct from old.submitted_at
       or new.revoked_at is distinct from old.revoked_at
       or new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
       or new.about_org_id is distinct from old.about_org_id or new.report_year is distinct from old.report_year
       or new.token_hash is distinct from old.token_hash or new.issued_to_name is distinct from old.issued_to_name
       or new.issued_to_email is distinct from old.issued_to_email or new.issued_by is distinct from old.issued_by
       or new.issued_at is distinct from old.issued_at or new.expires_at is distinct from old.expires_at
    then
      raise exception 'statistics_submission_grants %: a claimed grant may only be stamped with return_id, once',
        old.id using errcode = 'check_violation';
    end if;
    if coalesce(current_setting('presby.grant_claim_active', true), '') <> 'true' then
      raise exception 'statistics_submission_grants %: a grant may only be claimed by the sanctioned submission function',
        old.id using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.revoked_at is not null then
    if new.submitted_at is not null or new.return_id is not null
       or new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
       or new.about_org_id is distinct from old.about_org_id or new.report_year is distinct from old.report_year
       or new.token_hash is distinct from old.token_hash or new.issued_to_name is distinct from old.issued_to_name
       or new.issued_to_email is distinct from old.issued_to_email or new.issued_by is distinct from old.issued_by
       or new.issued_at is distinct from old.issued_at or new.expires_at is distinct from old.expires_at
    then
      raise exception 'statistics_submission_grants %: a revocation may only set revoked_at',
        old.id using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.submitted_at is not null then
    if new.return_id is not null or new.revoked_at is not null
       or new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
       or new.about_org_id is distinct from old.about_org_id or new.report_year is distinct from old.report_year
       or new.token_hash is distinct from old.token_hash or new.issued_to_name is distinct from old.issued_to_name
       or new.issued_to_email is distinct from old.issued_to_email or new.issued_by is distinct from old.issued_by
       or new.issued_at is distinct from old.issued_at or new.expires_at is distinct from old.expires_at
    then
      raise exception 'statistics_submission_grants %: a claim must set submitted_at alone; return_id follows separately',
        old.id using errcode = 'check_violation';
    end if;
    if coalesce(current_setting('presby.grant_claim_active', true), '') <> 'true' then
      raise exception 'statistics_submission_grants %: a grant may only be claimed by the sanctioned submission function',
        old.id using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  raise exception 'statistics_submission_grants %: no recognized transition',
    old.id using errcode = 'check_violation';
end $$;

create trigger statistics_submission_grants_freeze
  before update on statistics_submission_grants
  for each row execute function presby_freeze_statistics_submission_grant();
```

### The extracted chain writer and the two thin callers

`presby_write_return_publication_chain()` centralizes **every** check shared
by both callers — report-year range, form-version existence, recipient-type
(must be `presbytery`), and **the F80 collision check, moved here verbatim
from `presby_publish_sasr_snapshot()`** — so both callers get the same
protection from one piece of code, and arms `presby.publication_write_active`
once, immediately before its own three inserts:

```sql
create or replace function presby_write_return_publication_chain(
  p_org uuid, p_recipient uuid, p_report_year integer, p_form_version text,
  p_payload jsonb, p_reconciled boolean,
  p_attested_by_name text, p_attested_role text,
  p_authorized_by uuid, p_minute_reference text
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_recipient_type organization_type;
  v_now            timestamptz := now();
  v_return_id      uuid;
  v_publication_id uuid;
  v_supersedes_id  uuid;
begin
  if p_report_year is null or p_report_year < 1900 or p_report_year > 2100 then
    raise exception 'presby_write_return_publication_chain: report year % out of range', p_report_year
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from sasr_form_versions where key = p_form_version) then
    raise exception 'presby_write_return_publication_chain: form version % is not seeded', p_form_version
      using errcode = 'invalid_parameter_value';
  end if;

  select organization_type into v_recipient_type from organizations where id = p_recipient;
  if v_recipient_type is distinct from 'presbytery' then
    raise exception 'presby_write_return_publication_chain: recipient % is not a presbytery (found %)',
      p_recipient, v_recipient_type using errcode = 'invalid_parameter_value';
  end if;

  -- THE COLLISION CHECK (F80/DECISION-147) — ONE location, both callers.
  -- congregation_statistics_about_org (drizzle/0045) re-checks the SAME
  -- predicate on the third insert below; a pass here makes that trigger's
  -- own rejection unreachable BY CONSTRUCTION, not by convention.
  if not (presby_org_affiliated(p_org, p_recipient, make_date(p_report_year, 1, 1))
          or presby_org_affiliated(p_org, p_recipient, make_date(p_report_year, 12, 31))) then
    raise exception
      'presby_write_return_publication_chain: % was not affiliated with % during % — a return for a year before this congregation joined this council cannot be published to it; it belongs to the council that received it, through the import path',
      p_org, p_recipient, p_report_year
      using errcode = 'invalid_parameter_value';
  end if;

  perform set_config('presby.publication_write_active', 'true', true);

  insert into statistical_returns (
    organization_id, about_org_id, report_year, form_version_key,
    provenance, payload, reconciled,
    attested_by_name, attested_role, attested_at, created_at
  ) values (
    p_org, p_org, p_report_year, p_form_version,
    'submitted', p_payload, p_reconciled,
    p_attested_by_name, p_attested_role, v_now, v_now
  )
  returning id into v_return_id;

  select p.id into v_supersedes_id
    from publications p
    join statistical_returns r on r.id = p.artifact_id and r.organization_id = p.organization_id
   where p.organization_id = p_org and p.record_class = 'statistical_return'
     and p.withdrawn_at is null and r.report_year = p_report_year
   order by p.published_at desc, r.created_at desc limit 1;

  insert into publications (
    organization_id, recipient_org_id, record_class, artifact_id,
    published_at, supersedes_id, authorized_by, minute_reference, withdrawn_at
  ) values (
    p_org, p_recipient, 'statistical_return', v_return_id,
    v_now, v_supersedes_id, p_authorized_by, p_minute_reference, null
  )
  returning id into v_publication_id;

  -- MECHANISM (named per Ruling 5): jsonb_to_record with an EXPLICIT AS-list
  -- of the same ~60 name/type pairs already in drizzle/0047's own
  -- congregation_statistics INSERT column list — copied verbatim from that
  -- list rather than retyped, so the only source of truth for "which 60
  -- fields, in which order" is one place a diff can catch. Extraction is by
  -- NAME (not position), so a missing key becomes a loud NULL rather than a
  -- silently shifted value, and drizzle/0046 section 2's DO-block assertion
  -- (field_spec keyset == congregation_statistics typed-column set) is what
  -- guarantees this list and the payload's keys agree. jsonb_populate_record
  -- against a row type was considered and rejected: it would silently accept
  -- a renamed/extra key with no diagnostic at all, where jsonb_to_record's
  -- explicit column list fails loudly instead — and by the time this INSERT
  -- runs, presby_enforce_sasr_field_spec() has ALREADY validated every key
  -- in p_payload against the 2024 spec on the statistical_returns insert
  -- above, so this extraction is working from an already-closed allow-list.
  insert into congregation_statistics (
    organization_id, about_org_id, year, provenance, publication_id,
    published_at, minute_reference,
    gains_professions_under18, gains_professions_18plus, gains_certificate, gains_other,
    losses_certificate, losses_deaths, losses_other,
    ending_active, ending_baptized, ending_affiliate, ending_other_participants,
    gender_woman, gender_man, gender_nonbinary,
    age_17_under, age_18_25, age_26_40, age_41_55, age_56_70, age_71_over, age_unknown,
    race_asian, race_african, race_african_american, race_black, race_hispanic,
    race_middle_eastern, race_native_american, race_white, race_other,
    disability_hearing, disability_mobility, disability_sight, disability_other,
    officers_ruling_elder_count, officers_deacon_count,
    baptisms_children, baptisms_adults,
    youth_4_under, youth_k_5, youth_6_8, youth_9_12,
    avg_weekly_worship_attendance, potential_giving_units,
    receipts_contributions, receipts_capital_building_funds,
    receipts_investment_endowment_income, receipts_bequests, receipts_other_income,
    receipts_subsidy_or_aid,
    exp_local_program, exp_local_mission, exp_capital, exp_investment,
    exp_per_capita_apportionment, exp_validated_mission_pcusa,
    exp_ga_theological_education_fund, exp_other_mission,
    budgeted_income, budgeted_expense
  )
  select p_recipient, p_org, p_report_year, 'published_by_congregation', v_publication_id,
         v_now, p_minute_reference, f.*
  from jsonb_to_record(p_payload) as f(
    gains_professions_under18 integer, gains_professions_18plus integer, gains_certificate integer, gains_other integer,
    losses_certificate integer, losses_deaths integer, losses_other integer,
    ending_active integer, ending_baptized integer, ending_affiliate integer, ending_other_participants integer,
    gender_woman integer, gender_man integer, gender_nonbinary integer,
    age_17_under integer, age_18_25 integer, age_26_40 integer, age_41_55 integer, age_56_70 integer, age_71_over integer, age_unknown integer,
    race_asian integer, race_african integer, race_african_american integer, race_black integer, race_hispanic integer,
    race_middle_eastern integer, race_native_american integer, race_white integer, race_other integer,
    disability_hearing integer, disability_mobility integer, disability_sight integer, disability_other integer,
    officers_ruling_elder_count integer, officers_deacon_count integer,
    baptisms_children integer, baptisms_adults integer,
    youth_4_under integer, youth_k_5 integer, youth_6_8 integer, youth_9_12 integer,
    avg_weekly_worship_attendance integer, potential_giving_units integer,
    receipts_contributions numeric, receipts_capital_building_funds numeric,
    receipts_investment_endowment_income numeric, receipts_bequests numeric, receipts_other_income numeric,
    receipts_subsidy_or_aid numeric,
    exp_local_program numeric, exp_local_mission numeric, exp_capital numeric, exp_investment numeric,
    exp_per_capita_apportionment numeric, exp_validated_mission_pcusa numeric,
    exp_ga_theological_education_fund numeric, exp_other_mission numeric,
    budgeted_income numeric, budgeted_expense numeric
  );

  return v_return_id;
end $$;

revoke all on function presby_write_return_publication_chain(
  uuid, uuid, integer, text, jsonb, boolean, text, text, uuid, text
) from public;
-- No grant to presby_app or presby_platform at all — called only by the two
-- DEFINER wrappers below, which run as the owner (F44) and need none.
```

`presby_publish_sasr_snapshot()` is **re-created** (`create or replace`, same
name, same 62-parameter signature — no live caller to break, per Phase 2's
grep) with its body **shortened**: read `v_org`, resolve `v_recipient :=
presby_affiliation_parent_as_of(v_org, current_date::date)` (unchanged — this
caller's instant is always today), validate the 60 typed parameters' bounds
(unchanged — `v_count_max`/`v_money_max`, the one thing genuinely specific to
this caller's typed signature vs. the grant path's raw `jsonb`), build
`v_payload` (unchanged, the same three `jsonb_build_object` chunks), then
`return presby_write_return_publication_chain(v_org, v_recipient,
p_report_year, '2024', v_payload, true, null, null, null,
p_minute_reference)`. **The report-year range check, the form-version-exists
check, the recipient-type check and the collision check are DELETED from
this function's own body** — they now live once, in the helper, reached via
the same call path, so the self-publish caller's behavior (message text,
`errcode`) is unchanged but the logic is no longer duplicated. Header comment
states this supersedes `drizzle/0047` section 7's body per the existing
fix-forward convention (`0047` stays as merged; `0049` is `create or
replace`, not an edit to `0047`).

`presby_submit_granted_return(p_token_hash text, p_payload jsonb,
p_attested_by_name text, p_attested_role text) returns uuid`:

```sql
create or replace function presby_submit_granted_return(
  p_token_hash text, p_payload jsonb, p_attested_by_name text, p_attested_role text
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_grant     record;
  v_recipient uuid;
  v_return_id uuid;
  v_claimed   uuid;
begin
  select * into v_grant from statistics_submission_grants where token_hash = p_token_hash;

  if v_grant.id is null or v_grant.revoked_at is not null
     or v_grant.submitted_at is not null or v_grant.expires_at <= now()
  then
    raise exception 'presby_submit_granted_return: grant not usable' using errcode = 'insufficient_privilege';
  end if;

  -- THE AFFILIATION INSTANT (Ruling 2 / F80). Recipient is resolved FRESH
  -- from the affiliation history — never from the grant's stored
  -- organization_id, which is provenance of issuance, never authority to
  -- receive (D19, unchanged). grant.organization_id is used ONLY as a
  -- staleness check: agreement makes the grant live, disagreement makes it
  -- a lapsed credential, refused under the SAME uniform literal.
  v_recipient := presby_affiliation_parent_as_of(v_grant.about_org_id, current_date::date);
  if v_recipient is null or v_recipient is distinct from v_grant.organization_id then
    raise exception 'presby_submit_granted_return: grant not usable' using errcode = 'insufficient_privilege';
  end if;

  if p_attested_by_name is null or char_length(btrim(p_attested_by_name)) not between 1 and 255 then
    raise exception 'presby_submit_granted_return: attestation out of range' using errcode = 'invalid_parameter_value';
  end if;
  if p_attested_role is null or char_length(btrim(p_attested_role)) not between 1 and 100 then
    raise exception 'presby_submit_granted_return: attestation out of range' using errcode = 'invalid_parameter_value';
  end if;

  -- THE CLAIM (Ruling 5c). ONE indexed UPDATE; RETURNING is the concurrency
  -- control. A double-click, two tabs, or a back-button resubmit all lose
  -- HERE — Postgres blocks the second UPDATE on the row lock until the
  -- first commits, then re-evaluates the WHERE clause and finds
  -- submitted_at already set.
  perform set_config('presby.grant_claim_active', 'true', true);
  update statistics_submission_grants
     set submitted_at = now()
   where id = v_grant.id and submitted_at is null and revoked_at is null and expires_at > now()
  returning id into v_claimed;

  if v_claimed is null then
    raise exception 'presby_submit_granted_return: grant not usable' using errcode = 'insufficient_privilege';
  end if;

  -- THE WRITE. If anything below raises, the claim above rolls back with
  -- it — one transaction, so a failed submission returns the grant to
  -- exactly its pre-call state, never a stuck half-claim.
  v_return_id := presby_write_return_publication_chain(
    v_grant.about_org_id, v_recipient, v_grant.report_year, '2024',
    p_payload, true, btrim(p_attested_by_name), btrim(p_attested_role), null, null
  );

  update statistics_submission_grants set return_id = v_return_id where id = v_claimed;

  return v_return_id;
end $$;

revoke all on function presby_submit_granted_return(text, jsonb, text, text) from public;
grant execute on function presby_submit_granted_return(text, jsonb, text, text) to presby_app;
```

Plus `presby_preview_granted_return(p_token_hash text) returns table
(about_org_name text, report_year integer, form_version_key text)` —
`language sql stable security definer`, same one-indexed-lookup shape, no
mutation, `grant execute … to presby_app` — backing the page's read-only
resolve (API Contract, above).

**`F60`: every function created or re-created in `0049` carries `set
search_path = public, pg_temp`, `pg_temp` last** — `presby_write_return_
publication_chain`, the re-created `presby_publish_sasr_snapshot`,
`presby_submit_granted_return`, `presby_preview_granted_return`. The two
small trigger functions (`presby_check_grant_about_org_unmanaged`,
`presby_freeze_statistics_submission_grant`) are `language plpgsql` with no
cross-schema read risk (organizations has no RLS; the grants table's own
columns only) and follow `presby_check_about_org_affiliated`'s own sibling
triggers' precedent of no explicit `search_path` on a trigger-only function —
**stated explicitly, not by omission**, since F60's rule targets `SECURITY
DEFINER` functions and these two are `SECURITY INVOKER`/plain.

### Drizzle: `src/lib/db/domain/returns.ts` (extended, no new file — architect's ruling)

```ts
import { users } from "../schema";
// … existing imports …

export const statisticsSubmissionGrants = pgTable(
  "statistics_submission_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    aboutOrgId: uuid("about_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reportYear: integer("report_year").notNull(),
    tokenHash: text("token_hash").notNull(),
    issuedToName: text("issued_to_name").notNull(),
    issuedToEmail: text("issued_to_email").notNull(),
    issuedBy: uuid("issued_by")
      .notNull()
      .references(() => users.id),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    returnId: uuid("return_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    unique("statistics_submission_grants_id_org_key").on(t.id, t.organizationId),
    unique("statistics_submission_grants_token_hash_key").on(t.tokenHash),
    index("statistics_submission_grants_about_org_year_idx").on(t.aboutOrgId, t.reportYear),
    index("statistics_submission_grants_org_idx").on(t.organizationId),
    check("statistics_submission_grants_token_hash_shape", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("statistics_submission_grants_report_year_range", sql`${t.reportYear} between 1900 and 2100`),
    check("statistics_submission_grants_expiry_shape", sql`${t.expiresAt} > ${t.issuedAt}`),
    check("statistics_submission_grants_name_shape", sql`char_length(btrim(${t.issuedToName})) between 1 and 255`),
    check("statistics_submission_grants_email_shape", sql`char_length(${t.issuedToEmail}) between 3 and 320`),
    check("statistics_submission_grants_claim_shape", sql`${t.returnId} is null or ${t.submittedAt} is not null`),
    // The partial unique (statistics_submission_grants_live_idx) and the
    // composite FK to statistical_returns are 0049-only — Drizzle has no
    // partial-unique builder in this table's dialect usage elsewhere in the
    // tree and no cross-file composite-FK builder; see this module's header
    // for the established "much of the real enforcement is not expressible
    // in Drizzle" convention this table follows too.
  ],
);
```

Header comment addition to `returns.ts` (replacing the "ships in increment 6"
forward-reference) states the module now carries three exports and repeats
the composite-FK correction inline so a reader of the Drizzle file alone
still sees the F2-relevant fact even though the FK itself is 0049-only.

### `src/lib/sasr-fields.ts` — new flat file (labels/groups/order; the DB owns type/bounds)

```ts
export interface SasrFieldMeta {
  key: string;   // must equal a key in sasr_form_versions.field_spec->'fields'
  label: string;
  inputType: "count" | "currency";
}
export interface SasrFieldGroup {
  title: string;
  fields: SasrFieldMeta[];
}
export const SASR_FIELD_GROUPS: Record<string, SasrFieldGroup[]> = {
  "2024": [
    { title: "Gains", fields: [/* gains_* , 4 fields */] },
    { title: "Losses", fields: [/* losses_*, 3 fields */] },
    { title: "Ending rolls", fields: [/* ending_*, 4 fields */] },
    { title: "Gender", fields: [/* gender_*, 3 fields */] },
    { title: "Age", fields: [/* age_*, 7 fields */] },
    { title: "Race and ethnicity", fields: [/* race_*, 9 fields */] },
    { title: "Disability", fields: [/* disability_*, 4 fields */] },
    { title: "Officers", fields: [/* officers_*, 2 fields */] },
    { title: "Baptisms", fields: [/* baptisms_*, 2 fields */] },
    { title: "Church school / youth", fields: [/* youth_*, 4 fields */] },
    { title: "Worship and giving units", fields: [/* avg_weekly_worship_attendance, potential_giving_units */] },
    { title: "Receipts", fields: [/* receipts_*, 6 fields */] },
    { title: "Expenditures", fields: [/* exp_*, 8 fields */] },
    { title: "Budget", fields: [/* budgeted_*, 2 fields */] },
  ],
};
```

**Parity test** (Vitest, DB-backed — needs the seeded `sasr_form_versions`
row): `sasr-fields.test.ts` asserts `Object.keys(fieldSpec['2024'].fields).sort()
` equals `SASR_FIELD_GROUPS['2024'].flatMap(g => g.fields.map(f => f.key)).sort()`
— the third leg of drizzle/0046 section 2's already-established
DB-spec/typed-column parity assertion, now closing the DB-spec/TS-label leg
too.

## Component / Page Plan

**Pages to create:**
- `src/app/(statistics-submit)/file-statistics/page.tsx` — Server Component,
  resolves `?token=` via `presby_preview_granted_return()`, renders either
  the generic "link no longer active" state or the client form. No
  `layout.tsx`, no `loading.tsx` (both segments' job is to render a terminal
  state; a Suspense boundary would flush a premature 200).
- `src/app/(statistics-submit)/file-statistics/submitted/page.tsx` — static,
  no token, no data, no `layout.tsx`, no `loading.tsx`.

**Components to create:**
- `src/app/(statistics-submit)/file-statistics/statistics-submit-form.tsx`
  (`'use client'`) — `react-hook-form` + `zod` (the established pattern),
  receives `{ fields, labels, aboutOrgName, reportYear, token }` as props,
  imports nothing from `@/lib/db`. Grouped `<fieldset>`s per `SASR_FIELD_
  GROUPS`, single column below `sm`, `inputMode="numeric"` on every count/
  currency input, a sticky submit bar, and **nothing saved on any failure
  path** — a failed submit re-renders the same filled-in form with the
  mapped error, never a partial redirect.
- Attestation block: name `<Input>`, role `<select>` (closed:
  clerk of session / moderator / other, with a conditional text input for
  "other" — matching `docs/ui-standards.md`'s native-`<select>` convention).
- `src/app/(org)/o/[slug]/admin/reports/issue-grant-form.tsx` (`'use client'`)
  — congregation `<select>` (populated from the SAME congregation list the
  statistics section already fetches, filtered client-side to `platformStatus
  !== 'managed'` as a UI hint only — the trigger is authority), report year,
  recipient name/email, optional expiry-days override.
- `src/app/(org)/o/[slug]/admin/reports/grants-table.tsx` — server-rendered
  table (`Badge` per status, same `PROVENANCE_LABELS`-style map as
  `statistics-table.tsx`), a `Revoke` button per live row opening a shadcn
  `AlertDialog` (Workflow Rule 2 — no native `confirm()`).

**Files to modify:**
- `src/lib/db/domain/returns.ts` — add `statisticsSubmissionGrants` (above).
- `src/app/(org)/o/[slug]/admin/reports/page.tsx` — third section,
  `renderSubmissionGrantsSection()`, same shape as the two existing
  `render*Section()` helpers, gated by `statistics.submission_grants` in
  addition to the page's existing `org_portal.reports` flag and
  `statistics.manage` permission (a triple gate).
- `src/app/(org)/o/[slug]/admin/reports/actions.ts` — add
  `issueStatisticsGrantAction` / `revokeStatisticsGrantAction`.
- `src/proxy.ts` — two exact-path additions to `PUBLIC_PATHS`:
  `/file-statistics` and `/file-statistics/submitted`. No prefix, no import.
- `src/lib/audit.ts` — three new `AUDIT_ACTIONS` keys (below).
- `scripts/seed.ts` — one new `feature_flags` row, `statistics.submission_
  grants`, `enabled: false`, description matching the `org_portal.reports`
  entries' style.
- `scripts/check-audit-coverage.mjs` — `MUTATION_RE` extended to include
  `execute` (Ruling 11, taken — see below).
- `docs/product/functionality-map.md`, `docs/release-notes/vX.Y.md` — at
  Phase 6, per Workflow Rules 14/skill.

## Design Rulings (in the order owed)

**1. F80 — which check moves, and why.** The year-endpoint collision check
(currently duplicated logic waiting to happen, since it already exists once
inside `presby_publish_sasr_snapshot()`) moves into the new shared
`presby_write_return_publication_chain()`, run once, before any insert, using
the CALLER-resolved `p_recipient`. Both callers — the unchanged self-publish
path and the new grant path — get identical protection from one piece of
code; `congregation_statistics_about_org` (drizzle/0045) still fires on the
third insert and still enforces the same predicate independently (defense in
depth against a direct-INSERT bypass of the chain writer), but a legitimate
call through either DEFINER function can never reach it as a *refusal*,
because the same check already ran and would have raised first. **Fixture:**
`test-rls.sql` §40(f) — the Tidewater/Coastal Plain transfer fixture, both
directions (a grant issued by the OLD presbytery before a transfer is dead
post-transfer via the affiliation re-verification in ruling 2; a grant issued
by the NEW presbytery for a report year that predates the transfer is refused
by the moved collision check, with the SAME message `presby_publish_sasr_
snapshot()`'s callers already see).

**2. The grant's affiliation instant.** **Taken as recommended**: claim-time
re-verification, `presby_affiliation_parent_as_of(about_org, current_date) =
grant.organization_id`. The recipient is *never* read from the grant row as
authority — it is resolved fresh from the affiliation history exactly as
`presby_publish_sasr_snapshot()` already does, and the grant's own
`organization_id` is used *only* as an equality check against that freshly
resolved value. Agreement means the grant is live; disagreement means the
presbytery that issued it no longer has this congregation, and the credential
is refused under the identical uniform literal as an expired or revoked one —
this dissolves the two-instant conflict for the grant path specifically
without touching D19's rule that authority always comes from the affiliation
history, never a stored id.

**3. `managed` exclusion — enforced at issuance, in the database, by a
trigger** (`presby_check_grant_about_org_unmanaged()`), not the UI picker.
`resolveMemberCongregation()`'s own filter (client-visible dropdown) is a
convenience, never authority, per CLAUDE.md's own rule restated in Phase 2.
**If a congregation becomes `managed` between issuance and submission**, the
outstanding grant is honored unchanged at claim time — there is no re-check
of `platform_status` inside `presby_submit_granted_return()`, deliberately:
re-checking would add a *third* instant to reconcile for no protective gain
(the credential's value already expires on its own schedule), and if the
congregation's own new clerk self-files first through `statistics.publish` in
the interim, the *existing* supersession chain (`publications.supersedes_id`,
derived, never accepted as a parameter) resolves the conflict as an ordinary
correction — exactly Phase 2's own observation that this makes assumption 3 a
policy choice, safely relaxable later, not a structural dependency.

**4. The two-vs-three UPDATE transitions and the GUC.** Architect's ruling
undersold its own mechanism slightly: because the claim and the stamp are two
separate statements inside one transaction (`presby_submit_granted_return()`
— claim first via one indexed `UPDATE … RETURNING`, then the chain write,
then the stamp), the guard trigger must permit **three** shapes, not two:
revoke, claim (`submitted_at` alone), and stamp (`return_id` alone, from an
already-claimed row). All three require nothing else on the row to move; only
the claim and the stamp require `presby.grant_claim_active`; the revoke does
not (ordinary tenant DML, already grant-closed to `revoked_at`). This is
still exactly one new, unshared GUC and the SAME column-level-grant-closes-
the-tenant-path mechanism QA-2 proved for `congregation_statistics`'s
withdrawal pair — `presby_app` holds `update (revoked_at)` only, so it cannot
reach the claim or the stamp at the grant layer regardless of whether it ever
arms the GUC.

**5. Data model** — full DDL above.

**6. API contract** — full contract above, including the two-tier uniformity
rule (token-liveness failures collapse to one literal at the SQL layer and
one `ActionResult` shape at the TS layer; a *validated* holder's form errors
are specific, because by that point the requester has already proven
possession of the token and specificity is no longer an enumeration leak).

**7. Component / page plan** — above. Mobile: grouped `<fieldset>`s, single
column below `sm`, `inputMode="numeric"`, a sticky submit bar, nothing saved
on failure. Verified in a real phone-viewport browser session before Phase 5
(CLAUDE.md's "Verify in a Browser" — this is the one page whose user cannot
call support and gets one attempt).

**8. Implementation order and implementers** — below.

**9. Edge cases** — below.

**10. `test-rls.sql` §40 and the DB-backed vitest files owed** — below.

**11. `check:audit` `execute` extension — TAKEN.** `scripts/check-audit-
coverage.mjs`'s `MUTATION_RE` is extended to `/\bdb\s*\.\s*(insert|update|
delete|execute)\b/`. Rationale: `src/app/(statistics-submit)/actions.ts`
will contain `db.execute(sql`select presby_submit_granted_return(…)`)` and
nothing else the current regex recognizes as a mutation — without the
extension, `check:audit` would silently pass this file whether or not
`recordAudit()` is present, exactly the blind spot Phase 2 named. The
extension was verified tree-wide by the architect to be a no-op everywhere
else today (the only other `.execute(`-bearing `actions.ts`,
`(admin)/admin/2fa/actions.ts`, already calls `recordAudit`), and this
pipeline's own new file becomes the second, non-degenerate case proving the
extension does something. One-line change, folded into api-developer's Phase
4 pass; no new test file (the script has none today) — the fixture proof is
the tree itself.

### `test-rls.sql` §40 — "Submission grants — a third credential class, and the affiliation instant it forces a ruling on (F80/DECISION-147)"

> **Renumbered at integration (2026-09-25).** This block was authored as §36,
> the next free number at the time. `main` landed §36–§39 first (the lifecycle
> pipeline's F60/F61/F62 sections and the security pipeline's round-B section),
> so the merge renumbered this block to **§40** and every `§36` reference in
> this work-log now reads `§40`. The sub-part letters `(a)`–`(h)` are
> unchanged. The `scripts/test-rls.sql:NNNN` line numbers cited in the
> failing-first table and the Phase 4 notes below are the PRE-MERGE
> line numbers and are kept verbatim as the record of what was run; the same
> assertions now sit roughly 1,050 lines lower in the merged file.

Appended as one Rule-16-delimited block, next available section number.
Mirrors §35's style and its "what this suite can and cannot prove" caveat —
the grant table's own INSERT/UPDATE grant shape is provable on `presby_app`;
the freeze trigger's OWNER-connection branch is proved in `grants.test.ts`.

- **(a) Grant shape.** `has_column_privilege('presby_app', 'statistics_
  submission_grants', 'revoked_at', 'UPDATE') = true`;
  `has_column_privilege(..., 'submitted_at', 'UPDATE') = false`;
  `has_column_privilege(..., 'return_id', 'UPDATE') = false`; a `relacl`
  assertion that `presby_app` holds no table-level UPDATE (column-scoped
  only, mirroring §35(d)'s QA-2 style); `presby_platform` holds no INSERT.
- **(b) The freeze, tenant side.** As `presby_app`, with a seeded live grant:
  an UPDATE setting `revoked_at` alone succeeds; an UPDATE setting
  `submitted_at` (armed or not, `presby.grant_claim_active` set or not)
  fails with `permission denied` (the grant-layer refusal, not the trigger —
  named explicitly per §35(d)'s "unarmed vs. grant-closed" distinction) —
  proving column privilege refuses before any trigger is consulted.
- **(c) The claim, end to end, as `presby_app`, no org context set at all**
  (the actual anonymous-request shape): `select presby_submit_granted_return(
  <seeded token hash>, <valid payload>, 'Jane Clerk', 'clerk_of_session')`
  succeeds and returns a `uuid`; a SECOND call with the SAME token fails with
  the uniform literal (non-repeatable); a THIRD call reading the resulting
  `statistics_submission_grants` row confirms `submitted_at` and `return_id`
  both set and agreeing with the returned id.
- **(d) The uniform-literal probe.** Four calls to `presby_submit_granted_
  return()` — nonexistent token hash, an expired-fixture token, a
  revoked-fixture token, an already-submitted-fixture token — all four raise
  `errcode = 'insufficient_privilege'` with the identical message text
  `presby_submit_granted_return: grant not usable`, asserted by string
  equality, not merely "some error."
- **(e) Issuance-time triggers.** An INSERT naming an `about_org_id` NOT
  affiliated with `organization_id` today → refused (reuse of drizzle/0045's
  checker); an INSERT naming a `managed` `about_org_id` → refused by the new
  trigger; a legitimate INSERT (unmanaged, affiliated) → succeeds.
- **(f) F80 regression — the Tidewater/Coastal Plain fixture, both
  directions.** (i) A grant issued by Tidewater for a congregation that later
  transfers to a different presbytery: claim-time re-verification refuses
  under the uniform literal. (ii) A grant issued by Coastal Plain [substitute
  the fixture's actual post-transfer presbytery] naming a `report_year`
  that predates the transfer: the moved collision check inside
  `presby_write_return_publication_chain()` refuses with the SAME message
  text `presby_publish_sasr_snapshot()`'s own callers already see, proving
  one shared code path serves both.
- **(g) No drift in the re-created `presby_publish_sasr_snapshot()`.**
  Re-run §34's exact self-publish test vector through the refactored
  function; assert byte-identical `statistical_returns`/`publications`/
  `congregation_statistics` rows to what §34 already asserts, and re-run
  F39's equality assertion (`congregation_statistics.published_at =
  publications.published_at`, `minute_reference` match).
- **(h) Catalog pins.** Every function this section names carries
  `search_path=public, pg_temp` in `pg_proc.proconfig` (F60); the three
  triggers exist, are enabled, and execute the named functions (mirroring
  §35(e)'s style, so a dropped trigger fails this suite too).

**DB-backed vitest files:** `src/lib/db/domain/grants.test.ts` (owner
connection — every proof (b)-(h) above needs an owner-connection twin where
`presby_app`'s grant refuses it from reaching the trigger at all) and
`src/lib/statistics-grants.test.ts` (business logic — see Implementation
Order step 3).

### Audit Events (new `AUDIT_ACTIONS` keys, `src/lib/audit.ts`)

```ts
STATISTICS_GRANT_ISSUED: "tenant.statistics_grant.issued",
// Metadata: { organizationId, aboutOrgId, reportYear }. Actor: the signed-in
// issuing admin (ordinary session, no override).
STATISTICS_GRANT_REVOKED: "tenant.statistics_grant.revoked",
// Metadata: { organizationId, aboutOrgId, reportYear, grantId }.
STATISTICS_GRANT_SUBMITTED: "tenant.statistics_grant.submitted",
// Written from src/app/(statistics-submit)/actions.ts, NOT from
// src/lib/statistics-grants.ts (the one deliberate divergence from this
// pipeline's own "lib does the SQL, actions.ts does the audit" convention,
// forced by the no-session shape): actor = { userId: null, email:
// issuedToEmail }, resourceId = the grant id, metadata = { organizationId,
// aboutOrgId, reportYear, returnId }. Never the raw token or its hash.
```

`recordAudit()`'s existing `RecordAuditInput.actor` override (`{ userId:
null, email }`, `src/lib/audit.ts:304-323`) is used exactly as
`requestPasswordReset()` uses it — no new mechanism.

## Implementation Order

1. **Schema — database-admin.** `drizzle/0049_presby_submission_grants.sql`:
   the table, both triggers, the freeze trigger, the extracted chain writer,
   the re-created `presby_publish_sasr_snapshot()`, `presby_submit_granted_
   return()`, `presby_preview_granted_return()`. `src/lib/db/domain/returns.ts`
   extended. `scripts/seed-dev.sql` gains one appended fixture block (a live
   grant + one already-expired one, for `page.test.tsx`/e2e fixtures) —
   Rule 16 delimited block at the file's end. `scripts/test-rls.sql` §40
   (below) and `src/lib/db/domain/grants.test.ts` (owner-connection proofs:
   unarmed claim/stamp refused, armed-and-correctly-shaped claim then stamp
   accepted once and refused on repeat, revoke accepted, mixed-shape
   refused, about-org/unmanaged triggers, the F80 fixture, `search_path`
   catalog pins). `npm run db:push` on this pipeline's Neon branch, then
   `npm run docs:erd`.
2. **Flag + role binding.** `scripts/seed.ts` — add `statistics.submission_
   grants`, `enabled: false`. No `FEATURE_CATALOG`/permission edit (reused
   key).
3. **Server — api-developer.** `src/lib/statistics-grants.ts` (issuance,
   revocation, listing, the public boundary function), `src/app/(statistics-
   submit)/actions.ts`, the two `reports/actions.ts` additions, the two
   `proxy.ts` path additions, the `audit.ts` action keys, the `check-audit-
   coverage.mjs` extension, the email template/link. `src/lib/statistics-
   grants.test.ts` (permission gate, parent-path check, partial-unique
   translation, revoke's three-way distinction, the public wrapper's
   flag-off/invalid/expired/revoked/spent parity via mocked DB errors,
   rate-limit invocation). `src/lib/sasr-fields.test.ts` (the parity test).
4. **UI — ux-developer.** `file-statistics/page.tsx`, `statistics-submit-
   form.tsx`, `file-statistics/submitted/page.tsx`, `issue-grant-form.tsx`,
   `grants-table.tsx`, the reports page's third section. Verified at 360px
   in a real browser per CLAUDE.md.
5. **Audit events** — `STATISTICS_GRANT_ISSUED`, `STATISTICS_GRANT_REVOKED`,
   `STATISTICS_GRANT_SUBMITTED` (the no-session actor-override shape).
6. **Running-server e2e smoke** (Phase 4 gate: `(statistics-submit)` is a new
   public route touching neither `src/auth.ts` nor `(auth)/`, so the
   auth-specific mandatory smoke does not literally apply — but this
   pipeline names an equivalent smoke anyway, because it is the platform's
   *first* unauthenticated write path and Phase 2's whole security posture
   rests on the failure states being indistinguishable in a real browser,
   not just in unit tests):
   - Issue a grant from a seeded presbytery admin session → confirm the
     email lands in the dev outbox (or `email_queue` row) with the correct
     `/file-statistics?token=…` link.
   - Open that link at a 360px viewport → fill the form → attest → submit →
     confirm redirect to `/file-statistics/submitted` and that the
     presbytery's reports page now shows the "Congregation reported" badge.
   - Re-open the SAME link → confirm the generic "no longer active" page
     (second submit refused).
   - Separately probe: an expired token, a revoked token, and the flag
     turned off — all three, and the just-spent token above, must render
     **byte-identical** copy at the same route.
7. **Release notes entry** — at Phase 6, via `/release-notes`.

**Implementer split** (tech-lead's call, per Phase 2's own framing): schema +
DB-backed tests is **database-admin**; the lib/actions/proxy/email/flag layer
is **api-developer**; the pages/components/mobile-verification layer is
**ux-developer**. Not `full-stack-developer` — the schema alone is the
riskiest change in the pipeline (a re-created function with no live caller
today but a real one tomorrow) and wants a dedicated pass before any UI is
built against it.

## Edge Cases & Risks

| Case | Handling |
|---|---|
| Live grant already exists for `(org, about_org, year)` | Partial unique violation → `invalid_input`, translated to "a grant is already outstanding — revoke it first" |
| Revoke an already-submitted grant | `revokeStatisticsGrant()` pre-checks and returns a distinct "already filed on \<date\>" message, never attempts the UPDATE |
| Double-click / two-tab / back-button resubmit | The atomic claim UPDATE; second attempt gets 0 rows, uniform "no longer active" |
| Congregation transfers presbyteries after issuance, before submission | Claim-time re-verification refuses under the uniform literal (dead credential) |
| Congregation transfers presbyteries after the report year, grant issued by the new presbytery | The moved collision check refuses with the same named error `presby_publish_sasr_snapshot()`'s own callers see (F80 fixture) |
| Congregation becomes `managed` between issuance and submission | Grant is still honored; a concurrent self-file resolves via existing supersession, not a special case |
| Flag off | Same uniform response, same round-trip shape, as an invalid token |
| Email enqueued but bounces | Named residual, out of scope (Phase 1) — the issuing clerk has no bounce visibility this pipeline; `email_queue`'s existing `failed` status is visible only via `(admin)` today |
| Payload out of range / bad attestation, on an otherwise-live grant | Distinct "check your entries" message — not folded into the uniform bucket, since token possession is already proven |
| Mobile, 60 fields at 360px | Grouped fieldsets, sticky submit, `inputMode="numeric"`, nothing saved on failure |
| `attested_role = "other"` with no free text | Client + server zod: `attestedRoleOther` required when `attestedRole === "other"` |
| Raw token at rest | Named residual, precedented: sits in `email_queue`'s stored HTML exactly as `password_reset` already does |
| A presbytery names an `about_org_id` that isn't its own child | `resolveMemberCongregation`'s parent-path re-resolution (already re-validated in `issueStatisticsGrant()`, never trusted from the client) |

## Implementer

**database-admin** first (schema batch), then **api-developer**, then
**ux-developer** — see Implementation Order.

## Proposed for the orchestrator (not edited on this branch, per Rule 16)

### `docs/schema-design-2.md` §6 corrections

Replace the current `statistics_submission_grants` sketch in §6 with:

```
statistics_submission_grants      (revised again, Phase 3, 2026-09-25 —
                                   drizzle/0049)
  id, organization_id,           -- the ISSUING presbytery
  about_org_id,                  -- the congregation being asked
  report_year,
  token_hash unique,             -- sha256 hex; never the token itself
  issued_to_name, issued_to_email, issued_by, issued_at, expires_at,
  submitted_at,                  -- moves ALONE first (the atomic claim)
  return_id,                     -- moves SECOND, once the chain has run —
                                 -- see the freeze trigger; NOT the same
                                 -- UPDATE as submitted_at
  revoked_at
  unique (organization_id, about_org_id, report_year)
    where revoked_at is null and submitted_at is null   -- one live grant
  foreign key (return_id, about_org_id)
    references statistical_returns (id, organization_id)  -- NOT
    -- (return_id, organization_id) -> statistical_returns (id,
    -- organization_id): the grant is owned by the presbytery
    -- (organization_id) and the return it claims is owned by the
    -- CONGREGATION (about_org_id) — the same correction drizzle/0047 made
    -- for congregation_statistics.publication_id (F45's pattern, a third
    -- occurrence).
```

**F80 resolution, recorded here rather than re-litigated at the next
external review:** the return→publication→projection chain's shared writer
(`presby_write_return_publication_chain()`, extracted in `drizzle/0049`)
carries a single year-endpoint affiliation collision check, run once before
any insert, reached by both `presby_publish_sasr_snapshot()` and
`presby_submit_granted_return()`. The grant path additionally re-verifies
the recipient against the affiliation history at claim time (never against
the grant's own stored `organization_id`, which is provenance of issuance
only) — a stale grant is refused as a lapsed credential before the shared
collision check is ever reached.

### `docs/decisions.md` — DECISION-147 (final text, supersedes the Phase 2 draft)

> **DECISION-147: A token-bearing submission grant is a *credential* — a
> third access mechanism alongside permissions and flags — and it authorizes
> exactly one write, inside one `SECURITY DEFINER` function, with no org
> context set by the caller.** The public submission page is its own
> un-brandable route group, `(statistics-submit)`, on the `(password-reset)`
> pattern: platform palette, no session, no `FEATURES.*` gate, exact paths in
> `src/proxy.ts`'s public allow-list, token in the query string, one uniform
> response for every credential-liveness failure (not found, expired,
> revoked, already submitted, stale affiliation, flag off, or a genuine DB
> failure) including identical round-trip shape when the flag is off. A
> credential is never mapped into `FEATURES.*`, a session claim, or the
> permission resolver; it names its own subject, so the function derives both
> organization ids from the grant row and the recipient is re-resolved fresh
> from the affiliation history at claim time — never from the grant's own
> stored `organization_id`, which is provenance of issuance, never authority
> to receive (D19 unchanged) — with the grant's stored value used only as a
> staleness check. The return → publication → projection chain keeps **one**
> writer and **one** `presby.publication_write_active` arming site:
> `drizzle/0049` extracts the three inserts, the report-year/form-version/
> recipient-type checks, and the year-endpoint affiliation collision check
> (F80) into a single internal, ungranted `presby_write_return_publication_
> chain()`, behind which both the re-created `presby_publish_sasr_snapshot()`
> (attestation null, as before) and the new `presby_submit_granted_return()`
> (attestation verified from the form — the first non-null values F57
> anticipated) become thin callers, sharing F80's fix by construction rather
> than by two independent patches. The grant row is claimed in two sanctioned
> steps inside one transaction — `submitted_at` first (the atomic,
> non-repeatable claim), `return_id` second (the stamp, once the chain has
> run) — guarded by a new, unshared GUC (`presby.grant_claim_active`) and a
> column-level grant restricting `presby_app` to `UPDATE (revoked_at)` alone,
> so a tenant connection cannot reach the claim or the stamp regardless of
> whether it arms the marker. `managed`-status exclusion is enforced by a
> database trigger at issuance, not the UI picker, and is not re-checked at
> claim time — a stale exclusion is a policy choice (relaxable later), not a
> structural dependency, because a concurrent self-file resolves through the
> existing supersession chain regardless. *(2026-09-25, tech-lead Phase 3,
> `docs/work-log/2026-09-25-submission-grants.md`, ruling on architect's
> Phase 2 draft and F80.)*

### `docs/TODO.md` lines

- **Done** (add at Phase 6, not now): `Submission grants (D16) — presbytery
  issuance + public token-based SASR filing shipped, drizzle/0049.`
- **Next Up / follow-ups** (add now, since these are explicit non-goals of
  this pipeline, not silently dropped): `Congregation "view own filing
  history" page — presby_list_own_congregation_publications() has been built
  and callable since drizzle/0038 and still has zero UI consumers (Phase 1
  assumption 4, deferred again this pipeline).` / `Bounce visibility for
  issued-grant emails — the issuing clerk has no signal today if delivery to
  issued_to_email fails (Edge Cases table).` / `presby_withdraw_publication()
  UI — still unbuilt; withdrawal is owner-only.`

### `CLAUDE.md` / agent-file follow-ups (Phase 2 checklist item 6, carried forward)

- Add `(statistics-submit)` to the enumerated un-brandable route groups under
  **Key Invariants → The Brand Is a Cascade Override**.
- Add the group's line to `.claude/agents/architect.md`'s route-group rules.
- Add an `INVARIANTS` entry to `src/lib/dev-docs.ts` for the credential
  mechanism (`enforcement: "trigger"` — the freeze trigger and the
  column-level grant together are what make it real; a permission or flag
  audit alone would not see it).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — Technical design | tech-lead | Complete — F80 ruled (shared collision check moved into the extracted chain writer); grant affiliation instant ruled (claim-time re-verification); `managed` exclusion ruled (issuance-time trigger, not re-checked at claim); three-transition UPDATE guard specified; full DDL for `statistics_submission_grants`, `presby_write_return_publication_chain()`, re-created `presby_publish_sasr_snapshot()`, `presby_submit_granted_return()`; `check:audit` `execute` extension taken | Design complete, implementer named | 2026-09-25 |

**Handoff:** to **database-admin** (Phase 4, schema batch first) —
`drizzle/0049_presby_submission_grants.sql`, `src/lib/db/domain/returns.ts`,
`scripts/seed-dev.sql` (appended block), `scripts/test-rls.sql` §40
(appended block), `src/lib/db/domain/grants.test.ts`. Then **api-developer**
(`src/lib/statistics-grants.ts`, `src/lib/sasr-fields.ts`,
`src/app/(statistics-submit)/actions.ts`, the two `reports/actions.ts`
additions, `src/proxy.ts`, `src/lib/audit.ts`, `scripts/check-audit-
coverage.mjs`, `scripts/seed.ts`). Then **ux-developer** (the two new pages,
the submit form, the issuance section, `issue-grant-form.tsx`,
`grants-table.tsx`, the 360px verification pass). Carry every **[BINDING]**
item from Phase 2 and every numbered ruling above forward verbatim into
Phase 4 — do not summarize away the DDL; database-admin should treat the SQL
in this section as the reference implementation, adjusting only where the
live catalog disagrees with something read here, and naming any such
disagreement in the Phase 4 Implementer Notes rather than silently
resolving it.

---

# Phase 4 — Implementation

## Batch A — schema, database-admin (2026-09-25)

**Migration mode: HAND-WRITTEN**, `drizzle/0049_presby_submission_grants.sql`
(pre-assigned at the Rule 16 kickoff). Not `db:push` and not `db:generate`:
Drizzle Kit emits no RLS, no policy, no trigger, no `SECURITY DEFINER`
function, no column-level grant and no partial unique index, and this
migration is almost entirely those things. Applied against the
`pipeline-submission-grants` Neon branch as the owner on the direct endpoint:

```
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0049_presby_submission_grants.sql
```

`drizzle/meta/_journal.json` gains `{ "idx": 49, "tag":
"0049_presby_submission_grants" }` and nothing else — `0048` stays free for the
concurrent lifecycle pipeline, and `idx` matches the filename's own number.

### Files Created

- `drizzle/0049_presby_submission_grants.sql` (1152 lines) — seven sections:
  the table + RLS + grants + column comments; the three triggers; the extracted
  `presby_write_return_publication_chain()`; the re-created
  `presby_publish_sasr_snapshot()`; `presby_submit_granted_return()`;
  `presby_preview_granted_return()`; and a post-condition `DO` block that fails
  the migration loudly if FORCE RLS, the policy, the column-level grant, the
  four `search_path` pins or the single-arming-site property is not in place.
- `src/lib/db/domain/grants.test.ts` (19 tests, DB-backed, owner connection) —
  the `PLATFORM_DATABASE_URL` twin of `test-rls.sql` §40, plus the two things no
  tenant connection can stage at all (the stale credential, and the disarmed
  direct INSERT on the chain).

### Files Modified

- `src/lib/db/domain/returns.ts` — `statisticsSubmissionGrants` added (the
  header's own standing note said it belongs here), header rewritten to say
  "three exports" and to repeat the composite-FK correction inline. **No
  `src/lib/db/domain/index.ts` change** — the architect's ruling holds: this
  module is already exported, so the shared barrel file is untouched.
- `drizzle/meta/_journal.json` — one appended entry.
- `scripts/test-rls.sql` — §40 appended as one Rule-16-delimited block at the
  END (eight sub-parts, 44 new assertions), **plus two unavoidable mid-file
  corrections in §35** (see Deviation 1).
- `scripts/seed-dev.sql` — one appended block before the file's closing
  `commit;`: three fixture grants for Quillhaven (live / expired / revoked).
- `src/lib/db/domain/publication.test.ts` — two assertions updated for the
  extraction (see Deviation 2).

### Schema Changes

**New table `statistics_submission_grants`** — `id`, `organization_id` (the
issuing presbytery, plain FK, `on delete cascade`), `about_org_id` (the
congregation, plain FK, `on delete cascade`), `report_year`, `token_hash`
(sha256 hex, unique, shape-CHECKed), `issued_to_name`, `issued_to_email`,
`issued_by` → `users(id)`, `issued_at`, `expires_at`, `submitted_at`,
`return_id`, `revoked_at`. `unique (id, organization_id)`; the composite FK
`(return_id, about_org_id) → statistical_returns (id, organization_id)`; the
partial unique `statistics_submission_grants_live_idx`; `FORCE ROW LEVEL
SECURITY` + one `tenant_isolation` policy; three triggers.

**Grant shape:** `presby_app` = `select, insert, update (revoked_at)`;
`presby_platform` = `select`; neither holds `delete`. Verified on the live
catalog through `aclexplode(relacl)` and `aclexplode(attacl)`, not through
`information_schema.role_table_grants` (which only shows grants the current
role is party to).

**Functions:** `presby_write_return_publication_chain()` (new, DEFINER,
ungranted), `presby_publish_sasr_snapshot()` (re-created, same 62-parameter
signature, thin), `presby_submit_granted_return()` (new, DEFINER, granted to
`presby_app`), `presby_preview_granted_return()` (new, DEFINER `stable`,
granted to `presby_app`), `presby_check_grant_about_org_unmanaged()` and
`presby_freeze_statistics_submission_grant()` (new, trigger-only, INVOKER,
ungranted).

### Audit Events

None written by this batch — the schema layer writes no audit rows. The three
keys the design owes (`STATISTICS_GRANT_ISSUED`, `STATISTICS_GRANT_REVOKED`,
`STATISTICS_GRANT_SUBMITTED`) belong to api-developer's batch, and Phase 2's
correction stands: `check:audit` cannot see `db.execute(...)` coverage today,
so coverage on the submission path is **by review, not by tripwire**, even
after the `MUTATION_RE` extension api-developer is taking.

### Proofs

**1. Whole-file idempotent re-apply.** Not asserted — measured. A 49-line
catalog snapshot (columns, every constraint definition, every index
definition, the policy's `qual`/`with_check`, `relrowsecurity`/
`relforcerowsecurity`, every trigger definition, `aclexplode(relacl)` and
`aclexplode(attacl)`, the `md5(pg_get_functiondef())` and `proconfig` of all
six functions, `proacl` for each, and row counts on
`statistics_submission_grants`/`statistical_returns`/`publications`/
`congregation_statistics`) taken after run A and again after run B:

```
=== RUN A ===  exit=0
=== RUN B ===  exit=0
STATE IDENTICAL ACROSS BOTH RUNS
```

The whole file was in fact applied five times over the course of this batch
(three of them as the restore step of a failing-first cycle), always exit 0,
always the same end state, with no row-count change.

**2. `scripts/test-rls.sql` as `presby_app` — exit 0, 456 passes (from 412).**
`psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql`. The
baseline on this branch before any of this work was 412; §40 adds 43 and the
split §35 arming pin adds 1.

**3. The `pg_proc.proconfig` pin, F60/DECISION-148:**

```
presby_preview_granted_return         |t|search_path=public, pg_temp|ends_in_pg_temp=t
presby_publish_sasr_snapshot          |t|search_path=public, pg_temp|t
presby_submit_granted_return          |t|search_path=public, pg_temp|t
presby_write_return_publication_chain |t|search_path=public, pg_temp|t
presby_check_grant_about_org_unmanaged      |f| (SECURITY INVOKER — no pin, deliberately)
presby_freeze_statistics_submission_grant   |f| (SECURITY INVOKER — no pin, deliberately)
```

Stated rather than omitted, per Phase 3: F60's rule targets `SECURITY DEFINER`
functions. The two trigger functions are INVOKER — one reads `organizations`
(verified `relrowsecurity = f`, no RLS at all) and the other reads `OLD`/`NEW`
and one GUC — so DEFINER would be the cargo cult DECISION-121 warns against.
`test-rls.sql` §40(h) asserts both halves.

**4. DB-backed vitest, serial** (`dotenv -e .env.local -- vitest run
--no-file-parallelism`): `publication.test.ts` (43) · `lifecycle.test.ts` ·
`org-identifiers.test.ts` · `grants.test.ts` (19) · `presbytery.test.ts` —
**5 files, 150 tests, all passing.** `presbytery.test.ts` is green against the
re-created publish function, which was the named risk.

**5. `npm run typecheck`** — clean. **`npm run check`** — all five tripwires
pass. **`npm run test`** (no DB env, the CI shape) — 3240 passed, 784 skipped,
0 failed.

**6. `npm run docs:erd`** — regenerated (needs `dotenv -e .env.local`; the bare
npm script throws on the missing `DATABASE_URL`). "refreshed 10 diagrams from
84 tables" and produced **no diff**: the new table is not in any of the ten
diagram groupings, so `docs/schema-design.md` is untouched by this branch.

### Failing-First (Phase 4 gate)

Each mechanism was removed, the suite re-run, the exact failure cited, the
mechanism restored, and the suite confirmed green again.

| Mechanism removed | Suite | Exact failure | Restored |
|---|---|---|---|
| `alter table … disable trigger statistics_submission_grants_freeze` | `test-rls.sql` | exit 3 — `psql:scripts/test-rls.sql:5044: ERROR: FAIL — an already-revoked grant was revoked again; the freeze trigger is not firing on the tenant path` (§40(b)) | exit 0, 456 |
| the same, against the owner-path twin | `grants.test.ts` | 4 failed / 15 passed — every test in "the freeze trigger, on the connection where no grant binds" | 19 passed |
| the `set_config('presby.grant_claim_active', …)` line removed from `presby_submit_granted_return()` (the claim's ARMING) | `test-rls.sql` | exit 3 — `psql:scripts/test-rls.sql:5090: ERROR: statistics_submission_grants ab0000…0001: a grant may only be claimed by the sanctioned submission function` (§40(c)); i.e. the freeze refuses even the sanctioned claimant when it fails to declare the act | exit 0, 456 |
| the atomic claim's guard predicate (`and submitted_at is null and revoked_at is null and expires_at > now()`) AND the `submitted_at` liveness pre-check, both removed | `test-rls.sql` | exit 3 — `psql:scripts/test-rls.sql:5090: ERROR: statistics_submission_grants ab0000…0001: already claimed by return 680e231d-…; a spent grant is immutable`. §40(c)'s second-call assertion no longer sees the uniform literal. **Worth recording precisely:** the second claim is caught by the freeze trigger's terminal check rather than sailing through — the two mechanisms are genuinely in series, and the assertion is not vacuous either way | exit 0, 456 |
| `drop trigger statistics_submission_grants_unmanaged` | `test-rls.sql` | exit 3 — `psql:scripts/test-rls.sql:5213: ERROR: FAIL — a grant was issued to a MANAGED congregation, which has its own portal and self-files` (§40(e)) | exit 0, 456 |
| the same | `grants.test.ts` | 1 failed / 18 passed — "refuses a grant about a MANAGED congregation" | 19 passed |

### `test-rls.sql` §40 — the eight sub-parts, as delivered

- **(a) grant shape** — FORCE RLS; exactly one policy, scoped both ways;
  `has_column_privilege` true on `revoked_at` and false on `submitted_at` /
  `return_id`; no table-level UPDATE and no DELETE in `relacl`;
  `presby_platform` holds exactly one privilege and it is SELECT; `presby_app`
  can execute the two credential functions and none of the three internal ones.
- **(b) the freeze, tenant side** — the revocation succeeds; the claim is
  refused **with the GUC armed**, and the probe asserts the message begins
  `permission denied` so a trigger-side refusal could not masquerade as the
  grant-side one ("a marker is not a privilege"); the freeze is then shown live
  on the tenant path through the one transition the column grant permits (a
  second revocation of a revoked row); DELETE refused.
- **(c) the claim, end to end, with NO org context at all** — asserts
  `presby_current_org() is null` first, so the probe cannot pass by accident;
  claims; proves the second call refused; then shows the grant row claimed and
  stamped, the artifact **invisible from the issuing presbytery's own context**
  (the publication event grants the read, not the tenant policy), the same
  artifact visible through `presby_list_published_returns_to_me()` with its
  attestation, the projection carrying the payload's own values, and F57's
  first non-null `attested_by_name`/`attested_role` read from the
  congregation's own — humanly unenterable — tenant space.
- **(d) the uniform literal** — four causes (nonexistent, expired, revoked,
  just-spent), asserted by **string equality** against
  `presby_submit_granted_return: grant not usable` and by errcode equality
  against `42501`, not by "some error was raised".
- **(e) issuance triggers** — managed refused; another council's congregation
  refused; the legitimate case accepted as a positive control; the partial
  unique proven by a second live grant for the same congregation-year.
- **(f) F80, both directions** — (i) the stale credential asserted
  structurally here and behaviourally in `grants.test.ts` (see Deviation 3);
  (ii) the late filer end to end, with the grant path's and the self-publish
  path's refusals captured and compared for **byte equality**, plus a
  `statistical_returns` row-count check proving nothing was written before the
  refusal.
- **(g) no drift in the re-created publish** — §34(h)'s own test vector
  re-run; artifact id, recipient resolution, payload, and the derived
  supersession chain; F39's equality re-run through
  `presby_list_published_returns_to_me()` (§34(d)'s own technique, because no
  single tenant context can see both tables); the 60-column projection asserted
  value-by-value including numeric scale; and an unreported field asserted NULL
  rather than a shifted neighbour.
- **(h) catalog pins** — three triggers enabled; the freeze is a row-level
  BEFORE UPDATE on the named function; the freeze reads `presby.grant_claim_active`
  and never `presby.publication_write_active` (F56's no-reuse rule, asserted
  both ways); exactly one function arms the claim marker; the four
  `search_path=public, pg_temp` pins; the two trigger functions INVOKER; and
  `presby_preview_granted_return()` proven `stable`, resolving a live token to
  one row and expired/revoked/nonexistent to **no row**.

### Implementer Notes — deviations, each with its reason

1. **Two mid-file edits to `scripts/test-rls.sql` §35, which Rule 16 asked me
   to avoid.** Both were forced, and neither could live in the appended block:
   - The F55 pin `presby_publish_sasr_snapshot() arms the chain GUC itself`
     became false the moment the arming site moved. It is replaced by two
     assertions that state the property F55 actually cares about — *exactly one
     function in the database arms it*, and *that function is the chain
     writer* — which is strictly stronger and no longer names a caller.
   - B-M2 asserted `'search_path=public' = any(proconfig)` by exact element
     match over 21 named functions, one of which is `presby_publish_sasr_snapshot`.
     F60/DECISION-148 requires the re-created body to pin `public, pg_temp`, so
     the exact match had to widen to accept either spelling. The assertion's
     *subject* is unchanged (a function that drops the clause entirely still
     fails); §40(h) pins the `pg_temp`-last form for 0049's own four. Both edits
     carry an inline comment naming `drizzle/0049` so the integration merge and
     the lifecycle pipeline's own `0043–0047` sweep can see why they moved.
2. **`src/lib/db/domain/publication.test.ts`, two assertions updated** — the
   same two facts, on the owner connection: a message-text regex that named the
   old in-function collision string, and a catalog pin on the old arming site.
   Both comments now point at `drizzle/0049` and at `grants.test.ts`'s
   byte-equality proof. Not listed in my brief, but leaving them red was not an
   option and rewriting them to pass without explaining why would be worse.
3. **Phase 3's `test-rls.sql` §40(f)(i) is structural here, behavioural in
   `grants.test.ts`, and the reason is a measured fact about the fixture.** A
   stale credential cannot be staged from a tenant connection at all:
   `statistics_submission_grants_about_org` refuses any INSERT whose about-org
   is not affiliated with the issuer TODAY, and staging it afterwards by
   transferring the congregation requires the two presbyteries' **common
   superior** as the acting council (`presby_transfer_affiliation()`'s true-
   transfer branch, G-3.0403(c)) — which the fixture's rootless Northern Reach
   does not have. I measured both refusals rather than inferring them. The
   owner-connection test stages the real historical shape instead (the Southern
   Fields held Quillhaven until 1995) by disabling the issuance trigger inside a
   rolled-back transaction, with the reason written at the call site.
4. **The four checks moved into the chain writer now raise under the chain
   writer's own name.** Phase 3's prose said the self-publish caller's message
   text was "unchanged" while its own DDL gave the helper its own message
   prefix; the DDL wins, because one shared string is the observable form of
   one shared code path, and §40(f)(ii) asserts the two callers see a
   byte-identical refusal. Every moved check keeps its **errcode**
   (`invalid_parameter_value`), which is what §34's own assertions test and what
   any future caller would branch on. Phase 2's grep (no application caller
   anywhere in `src/`) is what makes this safe this week.
5. **A post-condition `DO` block (section 7) is in the migration and was not in
   the design.** Five cheap, idempotent assertions — FORCE RLS, the policy, the
   column-level grant in both directions, the four `search_path` pins, and the
   single-arming-site count — in `drizzle/0045` section 0's own idiom. A
   migration that half-applies a credential mechanism should fail loudly, not
   leave the gap for the next reviewer.
6. **Three seed fixtures, not two, and deliberately no already-submitted one.**
   Live / expired / revoked, one per report year so the partial unique is
   satisfied by construction. A "spent" fixture would have to freeze a
   half-claimed row nobody actually wrote; §40(c) and §40(d) spend the live one
   inside a rolled-back transaction instead, which is the real state machine.
   The three raw dev-only tokens are documented in the seed block itself
   (`dev-grant-quillhaven-2026` is the working link on a fresh branch) and are
   No-Real-Data clean: invented church, `example.invalid` recipient.
7. **`presby_preview_granted_return()` shipped** even though my brief's
   deliverable list stopped at `presby_submit_granted_return()` — the Phase 3
   API contract requires it (the public page must resolve a token *without*
   writing), and building the page against a write function would be the bug.
8. **No `src/lib/db/domain/index.ts` edit and no `docs/schema-design.md` churn**
   — one fewer shared-file collision each, as the architect predicted.

### Facts measured on the live catalog that the next implementer should not re-derive

- `presby_app` `rolbypassrls = f`; `neondb_owner` **and** `presby_platform`
  `rolbypassrls = t`. A DEFINER function owned by `neondb_owner` is not
  filtered by `tenant_isolation` at all — that is the mechanism the anonymous
  path relies on, and the reason the application must set no org GUC.
- `organizations` has `relrowsecurity = f`. The unmanaged trigger needs no
  DEFINER.
- The seeded affiliation history: Quillhaven ← Southern Fields (…–1995-01-01),
  Quillhaven ← Northern Reach (1995-01-01–). This is the fixture behind every
  F80 assertion in both suites.
- `presby_transfer_affiliation()`'s true-transfer branch requires the common
  superior as actor; the Northern Reach has no parent, so no Quillhaven
  transfer is reachable from any tenant connection in this fixture.

---

## Handoff — to api-developer (Batch B)

Apply locally, in this order, against your own Neon branch:

```bash
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0049_presby_submission_grants.sql
# seed fixtures: the appended block at the end of scripts/seed-dev.sql
# (a fresh branch runs the whole file; an already-seeded one needs only that block)
psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql   # expect exit 0, 456 passes
```

`npm run db:seed` is unchanged by this batch — the new `statistics.submission_grants`
flag row is **yours** (`scripts/seed.ts`, seeded `enabled: false`).

**The Drizzle table** is `statisticsSubmissionGrants`, exported from
`src/lib/db/domain/returns.ts` (and therefore already re-exported through
`src/lib/db/domain/index.ts` — no barrel edit needed). Columns as in the design;
remember `submittedAt` and `returnId` are **not writable from `db`** — the
column-level grant stops you, by design. Your issuance path writes
`organizationId, aboutOrgId, reportYear, tokenHash, issuedToName,
issuedToEmail, issuedBy, expiresAt`; your revoke path writes `revokedAt` and
nothing else in the same statement, or the freeze trigger rejects it.

**The exact SQL signatures to bind to:**

```sql
presby_submit_granted_return(
  p_token_hash       text,   -- sha256 HEX, lower-case, 64 chars (CHECKed)
  p_payload          jsonb,
  p_attested_by_name text,   -- 1..255 after btrim
  p_attested_role    text    -- 1..100 after btrim
) returns uuid               -- the statistical_returns id

presby_preview_granted_return(
  p_token_hash text
) returns table (about_org_name text, report_year integer, form_version_key text)
```

Both are `grant execute … to presby_app` and revoked from `presby_platform`.
Call them on the RLS-enforced `db` connection with **no org context set** —
`withOrgContext()` is wrong here and is the confused-deputy shape DECISION-147
forbids. A dead token previews as **zero rows**, never an error.

**The refusal literal your mapper must match — byte for byte:**

```
presby_submit_granted_return: grant not usable
```

with `errcode = 'insufficient_privilege'` (SQLSTATE `42501`). It covers, and is
deliberately indistinguishable across: no such token, expired, revoked, already
submitted, and **stale affiliation** (the issuing presbytery no longer holds the
congregation). Map exactly that pair to your single `{ kind: "invalid" }`
response, together with a thrown/network/DB failure.

Two other refusal classes, both safe to distinguish because token possession is
already proven by the time they can fire:

- `presby_submit_granted_return: attestation out of range`, errcode
  `invalid_parameter_value` (`22023`).
- everything raised by the chain: the field-spec rejection
  (`statistical_returns: …` from `presby_enforce_sasr_field_spec()`), and
  `presby_write_return_publication_chain: …` for report-year range, unseeded
  form version, non-presbytery recipient, and the F80 year-endpoint collision —
  all `22023`. Fold these into your one generic "check the highlighted fields"
  category; never surface the SQL text to the browser.

**Issuance-side errors to translate:**

- `statistics_submission_grants_live_idx` unique violation (`23505`) → "a grant
  is already outstanding for this congregation and year — revoke it first".
- `statistics_submission_grants: <uuid> already has an active account …`
  (`22023`) → the managed-congregation message. Your picker should filter
  `platformStatus !== 'managed'`, but the trigger is the authority.
- `statistics_submission_grants: the organization this record is about was not
  affiliated with this council as of <date>` (`42501`) → the invalid-target
  message. This is `drizzle/0045`'s shared literal; do not try to distinguish
  its causes.
- The freeze trigger's `check_violation` (`23514`) strings — `already revoked
  at …`, `already claimed by return …`, `a revocation may only set revoked_at`
  — should never reach a user: `revokeStatisticsGrant()` pre-selects the row and
  returns its own message first, per the Phase 3 contract.

**Still owed by your batch**, unchanged from the Phase 3 plan:
`src/lib/statistics-grants.ts`, `src/lib/sasr-fields.ts` (+ its parity test),
`src/app/(statistics-submit)/actions.ts`, the two `reports/actions.ts`
additions, the two `src/proxy.ts` `PUBLIC_PATHS` entries, the three
`AUDIT_ACTIONS` keys, the `check-audit-coverage.mjs` `MUTATION_RE` extension,
`scripts/seed.ts`'s flag row, and the email template. Then **ux-developer**.

---

## Batch B — server, api-developer (2026-09-25)

Built exactly against database-admin's Batch A handoff — the two SQL
signatures, the uniform refusal literal, the column-level grant shape — with
one naming resolution and one factual correction, both recorded below rather
than silently reconciled.

**Naming resolution.** The orchestrator's kickoff prose called the public
boundary function `submitGrantedReturn`; Phase 3's own API Contract code
block names it `submitStatisticsGrant`. Built to the Phase 3 contract (the
literal, reviewed design), not the paraphrase — `previewGrantedReturn` keeps
the name Phase 3 left unfixed.

**Factual correction — a second errcode in the `invalid_input` bucket.**
Batch A's handoff says the field-spec rejection from
`presby_enforce_sasr_field_spec()` carries `22023`. Measured against the live
catalog (`src/lib/statistics-grants.test.ts`'s own out-of-bounds-payload
test failed before this was found): that trigger's own `raise exception`
sites all carry `errcode = 'check_violation'` (**`23514`**), unchanged since
`drizzle/0046` — `drizzle/0049` never re-creates that function. `22023` is
correct for the *chain writer's* four checks (report-year range, unseeded
form version, non-presbytery recipient, F80 collision) and for the
attestation-bounds check inside `presby_submit_granted_return()` itself —
only the field-spec trigger's own raises are `23514`. `submitStatisticsGrant()`
now maps **both** `22023` and `23514` to `{ kind: "invalid_input" }`, with an
inline comment recording the discrepancy so a later reviewer doesn't
re-litigate it as a bug. Everything else in the handoff — the table/function
shapes, the uniform `42501`/`grant not usable` literal, `submittedAt`/
`returnId` being unwritable from `db`, no org context ever set — matched the
live catalog exactly.

### Files Created

- `src/lib/statistics-grants.ts` — issuance/revocation/listing (tenant DML,
  `withOrgContext()`, local `hasPermission()`/`resolveMemberCongregation()`
  copies mirroring `presbytery.ts`'s own per-module-duplication convention)
  and the public submission boundary (`previewGrantedReturn`,
  `submitStatisticsGrant` — no `personId`, no `organizationId`, ever).
- `src/lib/statistics-grants.test.ts` — 28 DB-backed tests (real Postgres,
  `hasDb` skip-guard): issuance forbidden/invalid_target/invalid_input/ok/
  duplicate-collision, listing, revocation's three-way distinction, and the
  full public-boundary lifecycle (preview live/expired/revoked/nonexistent,
  submit invalid for each dead-token cause, invalid_input for bad
  attestation and an out-of-bounds payload, one successful end-to-end spend
  with `auditFacts` populated, the non-repeatable-claim proof, and the
  flag-off same-bucket proof). Uses Marrowbone (`invited`, real Northern
  Reach child) at report years this file owns exclusively (209x) — never
  touches the seeded Quillhaven fixtures Batch A/`test-rls.sql` §40 rely on.
  Teardown follows `presbytery.test.ts`'s disable/enable-freeze-trigger
  convention, ordered child-before-parent (`statistics_submission_grants`
  before `statistical_returns` — the composite FK the other direction
  trips); re-run twice back-to-back to confirm idempotency, and confirmed
  zero residual rows and the flag restored to its prior state by direct
  query afterward.
- `src/lib/sasr-fields.ts` — labels/groups/order for the 2024 form's 60
  fields, keyed by `form_version_key`; type/bounds stay database-owned.
- `src/lib/sasr-fields.test.ts` — a static snapshot twin (no DB required,
  runs in CI) plus a DB-backed parity test against the live seeded
  `field_spec` (both key-set equality and per-field type agreement).
- `src/app/(statistics-submit)/actions.ts` — `submitGrantedReturnAction()`:
  IP-keyed rate limit (`stats_submit:<ip>`, 10/hour, the `pwreset_req`
  precedent) → `attestedRole`/`attestedRoleOther` collapse → call into
  `submitStatisticsGrant()` → one `recordAudit()` on success (no-session
  actor override) → `redirect("/file-statistics/submitted")`. No `auth()`
  anywhere in the file.
- `src/app/(statistics-submit)/actions.test.ts` — 17 mocked tests (no DB):
  the rate-limit key and its blocked-response strings, the attestedRole
  collapse (including the omitted-`attestedRoleOther` and whitespace-trim
  cases), every failure kind's fixed-string mapping asserted by `toEqual`
  (not "some error"), a same-call-count proof across failure kinds, the
  exact audit-event shape on success (including a token-absence grep over
  the serialized call), and the `auditFacts: null` degradation path.

### Files Modified

- `src/app/(org)/o/[slug]/admin/reports/actions.ts` — added
  `issueStatisticsGrantAction`/`revokeStatisticsGrantAction`, same
  `resolveActingIdentity(slug)` plumbing and error-mapping shape as every
  other action in the file.
- `src/lib/audit.ts` — three new `AUDIT_ACTIONS` keys:
  `STATISTICS_GRANT_ISSUED`, `STATISTICS_GRANT_REVOKED`,
  `STATISTICS_GRANT_SUBMITTED`.
- `src/lib/audit.test.ts` — the catalog-completeness `EXPECTED_ENTRIES` map
  extended with the three new keys (typecheck fails otherwise — the map's
  type is `Record<keyof typeof AUDIT_ACTIONS, string>`).
- `src/proxy.ts` — two exact `PUBLIC_PATHS` entries, `/file-statistics` and
  `/file-statistics/submitted`. No import, no claim, no DB — a two-line
  `Set` addition.
- `scripts/seed.ts` — one new `feature_flags` row,
  `statistics.submission_grants`, seeded `enabled: false`, inserted next to
  `org_portal.reports` for locality. Ran `npm run db:seed` against this
  pipeline's Neon branch to actually create the row (idempotent —
  `onConflictDoNothing`), confirmed by direct query.
- `scripts/check-audit-coverage.mjs` — `MUTATION_RE` extended to
  `/\bdb\s*\.\s*(insert|update|delete|execute)\b/` (Phase 2/3 ruling 11).
  Verified: `node scripts/check-audit-coverage.mjs` passes tree-wide, and
  `(statistics-submit)/actions.ts` (the one file whose only mutation is a
  `db.execute(...)`) is the non-degenerate case that proves the extension
  does something — before the extension, deleting its `recordAudit()` call
  entirely still passed the check; after, it correctly fails. No separate
  fixture test file, per Phase 2's own note that the script has none today.

### Audit Events

`STATISTICS_GRANT_ISSUED`/`STATISTICS_GRANT_REVOKED` — ordinary session
actor, written from `reports/actions.ts`, metadata `{ organizationId,
aboutOrgId, reportYear }` / `{ organizationId, aboutOrgId, reportYear,
grantId }`. `STATISTICS_GRANT_SUBMITTED` — no session, actor `{ userId: null,
email: issuedToEmail }`, written from `(statistics-submit)/actions.ts`,
`resourceType: "statistical_returns"`, `resourceId` the new return's id,
metadata `{ organizationId, aboutOrgId, reportYear, returnId }`. Never the
raw token or its hash in any audit row, anywhere — checked by grep in the
mocked test and by construction (`submitStatisticsGrant()`'s success payload
carries no token field at all).

**Coverage is by review, not by tripwire**, as Phase 2 required: the
`MUTATION_RE` extension makes `check:audit` *see* the mutation, but the
tripwire only proves *some* `recordAudit`/`auditEvents` reference exists
in the file — it cannot verify the actor shape, or that the token is absent
from metadata. Both properties are pinned by
`(statistics-submit)/actions.test.ts` instead.

### Proofs

- `npm run typecheck` — clean.
- `npm run check` — all five tripwires pass (`check:audit` explicitly
  re-verified both before and after the `MUTATION_RE` extension, per above).
- `npm test` (no DB env, the CI shape) — 3262 passed, 814 skipped, 0 failed
  (up from Batch A's 3240/784 — the +22 are this batch's non-DB tests: 5 in
  `sasr-fields.test.ts`'s static twin, 17 in `(statistics-submit)/
  actions.test.ts`; the +30 skipped are the DB-backed halves of both new
  `*.test.ts` files that need `DATABASE_URL`).
- DB-backed vitest, serial (`dotenv -e .env.local -- vitest run
  --no-file-parallelism`): `publication.test.ts` (43) · `lifecycle.test.ts`
  · `org-identifiers.test.ts` · `grants.test.ts` (19) · `presbytery.test.ts`
  · `statistics-grants.test.ts` (28, new) · `sasr-fields.test.ts` (7, new) —
  **7 files, 185 tests, all passing**, run twice to confirm the new file's
  teardown is idempotent.
- `scripts/test-rls.sql` as `presby_app` — exit 0, still 456/456 (unchanged
  by this batch; no schema touched).
- Confirmed via direct `psql` query after the DB-backed run: zero residual
  rows in `statistics_submission_grants`/`statistical_returns`/
  `publications`/`congregation_statistics` for the Marrowbone fixture, and
  the `statistics.submission_grants` flag restored to `enabled: false`.

### Implementer Notes — deviations, each with its reason

1. **The audit-metadata follow-up read uses `getPlatformDb()`, inside
   `statistics-grants.ts`, not a plain `db` select inside `actions.ts`** as
   Phase 3's prose literally describes. Measured, not assumed: `statistics_
   submission_grants` is `FORCE ROW LEVEL SECURITY` on `organization_id =
   presby_current_org()`, and the anonymous path sets no org GUC — a plain
   `db.select()` there returns zero rows unconditionally, audit metadata
   included. `getPlatformDb()` (owner connection, no grant binds it) is used
   exactly once, immediately after a successful spend, keyed on the
   `returnId` the same call just produced — the same "self-scoped, harmless"
   property Phase 3 named, and the same "verified caller, no membership to
   check" caller-shape `src/lib/sites.ts`'s own header documents for its
   platform-authorized readers, applied here to a caller that just proved
   authorization by spending the credential rather than by holding a
   platform feature. Kept inside `src/lib/`, matching every other
   `getPlatformDb()` call site in the tree (none appear in `src/app/**/
   actions.ts` today) — `submitStatisticsGrant()`'s `"ok"` variant now
   carries an `auditFacts` field so `actions.ts` never imports the owner
   connection itself. A failure in this one lookup degrades to `auditFacts:
   null` (a still-useful, if incomplete, audit row) rather than unwinding
   the write that already committed.
2. **`submitGrantedReturnAction` writes exactly ONE audit event, not three.**
   Phase 3's prose says "three `recordAudit()` calls" but names only one key
   (`STATISTICS_GRANT_SUBMITTED`) and one shape for the submission side; the
   other two keys (`STATISTICS_GRANT_ISSUED`/`REVOKED`) belong to
   `reports/actions.ts`, a different file. Read as a wording slip rather
   than a real three-call requirement — the Audit Events section is the
   contract followed here.
3. **`code === "23514"` added alongside `22023`** in
   `submitStatisticsGrant()`'s `invalid_input` mapping — see the factual
   correction above.
4. **`getPlatformDb()`/owner-connection imports required `vi.mock("@/auth",
   …)` in `statistics-grants.test.ts`** that no sibling DB-backed test file
   needs: `statistics-grants.ts` imports `@/lib/email`, whose `queue.ts`
   imports `@/lib/audit`, which imports `@/auth` at module scope — the exact
   `next-auth` → `next/server` resolution failure
   `password-reset-actions.test.ts`'s own header already documents for the
   same transitive path. Recorded here so the next DB-backed test file that
   touches `enqueueEmail` doesn't rediscover it.

### Contract the next agent (ux-developer) binds to

**Server actions:**

```ts
// src/app/(org)/o/[slug]/admin/reports/actions.ts — session, statistics.manage
issueStatisticsGrantAction(slug: string, input: IssueStatisticsGrantInput):
  Promise<ActionResult<{ id: string }>>
revokeStatisticsGrantAction(slug: string, grantId: string):
  Promise<ActionResult<{ id: string }>>

// src/app/(statistics-submit)/actions.ts — no session, no FEATURES.* gate,
// the token is the credential
submitGrantedReturnAction(input: {
  token: string;
  payload: Record<string, number | boolean | undefined>;
  attestedByName: string;
  attestedRole: "clerk_of_session" | "moderator" | "other";
  attestedRoleOther?: string; // required by the client when attestedRole === "other"
}): Promise<ActionResult>   // redirects to /file-statistics/submitted on success —
                            // it never resolves { ok: true } to the caller
```

**Read functions for the page** (`src/lib/statistics-grants.ts`, all
session-gated tenant reads except the last two):

```ts
listStatisticsGrants(viewerPersonId, organizationId):
  Promise<StatisticsGrantResult<StatisticsGrantRow[]>>
  // StatisticsGrantRow: { id, aboutOrgId, aboutOrgName, reportYear,
  //   issuedToName, issuedToEmail, issuedAt, expiresAt, submittedAt,
  //   returnId, revokedAt, status: "issued"|"expired"|"revoked"|"submitted" }

previewGrantedReturn(rawToken: string):
  Promise<{ aboutOrgName; reportYear; formVersionKey } | null>
  // null for EVERY dead-token cause — the page renders one generic
  // "this link is no longer active" state for all of them, never a
  // distinguishable one. Call this from the server component that resolves
  // `?token=`, never presby_submit_granted_return() itself (a write).
```

**Field metadata for the form** (`src/lib/sasr-fields.ts`):

```ts
SASR_FIELD_GROUPS["2024"]: SasrFieldGroup[]  // { title, fields: SasrFieldMeta[] }
// SasrFieldMeta: { key, label, inputType: "count" | "currency" }
sasrFieldKeys("2024"): string[]  // flattened, in display order
```

Bounds/types are NOT here — read `previewGrantedReturn`'s `formVersionKey`
and, if the page needs live bounds for client-side zod validation, query
`sasr_form_versions.field_spec` server-side and pass the parsed bounds down
as a prop (do not hand-roll a second copy of `min`/`max`).

**Flag and route contract:** `statistics.submission_grants` (bare
`isFlagEnabled()`, fail-closed) gates BOTH the reports-page issuance section
(alongside `org_portal.reports` and `statistics.manage`) and the public
`/file-statistics`/`/file-statistics/submitted` pages — both already in
`src/proxy.ts`'s `PUBLIC_PATHS`. No `layout.tsx` on either segment (Phase 2
binding); no `loading.tsx` on either (both segments' job is to render a
terminal state).

**Still owed, per Phase 3's Component/Page Plan** — none of this batch:
`src/app/(statistics-submit)/file-statistics/page.tsx`,
`.../file-statistics/statistics-submit-form.tsx`,
`.../file-statistics/submitted/page.tsx`,
`src/app/(org)/o/[slug]/admin/reports/issue-grant-form.tsx`,
`.../grants-table.tsx`, and the reports page's third section
(`renderSubmissionGrantsSection()`). The 360px mobile verification pass
(CLAUDE.md's "Verify in a Browser") is ux-developer's to run before Phase 5.

---

## Batch B, second pass (QA FAIL-1, Advisories 1–2) — api-developer (2026-09-25)

QA's Phase 5 verdict was **FAIL**, on one gap: `issueStatisticsGrantAction`
had no rate limit, though Phase 1 (work-log line 12) and Phase 2's
**[BINDING]** ruling ("issuance is separately limited per issuing org") both
required one, and Phase 3 dropped it without notation. Two advisories in the
same file/module were addressed alongside it, per the coordinator's
instruction. Scope was held to exactly these three items — no other file in
Batch C's (ux-developer's) concurrent second pass was touched, and neither
`e2e/statistics-submit.spec.ts` nor `src/proxy.test.ts` was read or edited.

### FAIL-1 — issuance rate limit, added

`src/app/(org)/o/[slug]/admin/reports/actions.ts` — `issueStatisticsGrantAction`
now calls `checkRateLimit` **before** `issueStatisticsGrant`, keyed
`stats_grant_issue:${identity.organizationId}` — **by organization only, not
also by user.** Stated in writing, since QA asked: a per-user key layered
alongside the per-org one would only ever *widen* the effective budget for a
presbytery with more than one admin holding `statistics.manage` — a strictly
weaker property than the one Phase 2 named ("per issuing org"), and the
wrong direction for the threat FAIL-1 itself described (a single compromised
or careless clerk account amplifying outbound email). One key, no second
axis. **Window: `max: 30, windowSeconds: 3600`** (30/hour) — generous enough
for a legitimate bulk pass (a large presbytery issuing to every member
congregation for a new report year in one sitting) while still bounding the
sustained-abuse ceiling FAIL-1 computed (~200 queued emails per congregation
across the full report-year range, absent any limit). Blocked response:
`"Too many grants issued recently. Try again in N minute(s)."` — the
`(password-reset)/actions.ts:51` pattern (`checkRateLimit`, one call, one
friendly-error return, `Math.ceil(retryAfterSeconds / 60)` pluralization).

Test: `src/app/(org)/o/[slug]/admin/reports/actions.test.ts` (new file — none
existed for this `actions.ts` before) pins the exact key
(`stats_grant_issue:<organizationId>`, never containing the acting user's
id), the exact blocked-response strings (plural and singular-minute cases),
that `issueStatisticsGrant`/`recordAudit` are never called when blocked, and
that revocation carries no rate limit at all (a closing act, not a
volume-amplifying one) — 7 tests, mocked at the `@/lib/statistics-grants` /
`@/lib/rate-limit` boundary, same principle as `admin/officers/
actions.test.ts`.

### Advisory 2 — revoke's audit metadata, restored

`revokeStatisticsGrant()` (`src/lib/statistics-grants.ts`) now selects
`aboutOrgId`/`reportYear` in its existing pre-select (no extra round trip)
and returns them in its `"ok"` data; `revokeStatisticsGrantAction` puts them
back into the audit metadata, matching Phase 3's Audit Events block
(`{ organizationId, aboutOrgId, reportYear, grantId }`) exactly — thinned to
`{ organizationId, grantId }` in the first pass. `statistics-grants.test.ts`'s
existing "revokes a live grant" test now asserts both fields on the returned
data (not a new test — strengthened in place, suffixed "regression for
thinned Phase 3 audit metadata"); `reports/actions.test.ts` asserts the full
audit-call shape by exact `toEqual`.

### Advisory 1 — the token hash in `console.error`, redacted

`submitStatisticsGrant()`'s unexpected-error catch (`statistics-grants.ts`,
QA's cited `:652`) no longer logs `err` — QA measured that Drizzle's own
`DrizzleQueryError.message` is built as `` `Failed query: ...\nparams:
...` ``, and `presby_submit_granted_return`'s first bound parameter is the
token hash, so the raw error object printed the credential's hash to the
server log on every unmapped SQLSTATE. Now logs `{ code: code ?? "unknown" }`
only — the SQLSTATE already computed by `pgErrorInfo()`, never the error
object and never `pgErrorInfo()`'s own joined `.message` chain (which is
built FROM that same leaking string, so it is not a safe substitute).
**Extended to the adjacent audit-facts-lookup catch a few lines above**
(same file, same class of risk, not itself flagged by QA — the bound
parameter there is `returnId`, a UUID rather than a secret, but the fix is
one line and keeps both catch blocks in this function under the same
discipline).

Test: `src/lib/statistics-grants-error-redaction.test.ts` (new file, mocked
— not the DB-backed `statistics-grants.test.ts`, since provoking a genuine
unmapped SQLSTATE from a live connection is impractical and mocking
`@/lib/db` there would break its real-connection tests). Fabricates the
exact `DrizzleQueryError`-shaped error QA reproduced, spies on
`console.error`, and asserts the serialized log output contains neither the
specific test token's hash nor any 64-character hex run at all (a sha256 hex
hash is always exactly 64 chars — the cause-agnostic form of the guard).
**Verified non-vacuous the same way database-admin's Batch A did**: reverted
the fix, confirmed both assertions fail against the raw `console.error(...,
err)` call (one on a naive `JSON.stringify`-based scan that turned out to be
a false negative — `Error.prototype.message` is non-enumerable, so
`JSON.stringify(new Error(...))` yields `{}` and would have silently passed
even the buggy code; corrected to walk the `.message`/`.cause` chain
directly, the same shape `pgErrorInfo()` itself uses, before trusting the
test), then restored the fix and confirmed both pass again.

### Proofs (this pass)

- `npm run typecheck` — clean.
- `npm run check` — all five tripwires pass.
- `npm test` (no DB env) — 3308 passed, 814 skipped, 0 failed (up from this
  pass's own starting point; +7 in the new `reports/actions.test.ts`, +2 in
  the new `statistics-grants-error-redaction.test.ts`).
- DB-backed vitest, serial: `statistics-grants.test.ts` — **28/28 passing**
  (same count as before this pass; the strengthened "revokes a live grant"
  assertion is not a new test). Full 7-file DB-backed sweep re-run —
  **185/185 passing**.
- `scripts/test-rls.sql` as `presby_app` — exit 0, still 456/456 (unaffected;
  no schema touched by this pass).
- Confirmed via direct `psql` query: zero residual rows for this pass's
  fixtures, `statistics.submission_grants` flag still `enabled: false`.

### Files touched, this pass

- **Modified:** `src/lib/statistics-grants.ts` (both `console.error` sites
  redacted; `revokeStatisticsGrant()`'s return type/data widened),
  `src/app/(org)/o/[slug]/admin/reports/actions.ts` (rate limit added to
  `issueStatisticsGrantAction`; `revokeStatisticsGrantAction`'s audit
  metadata restored), `src/lib/statistics-grants.test.ts` (one assertion
  strengthened).
- **Created:** `src/app/(org)/o/[slug]/admin/reports/actions.test.ts`,
  `src/lib/statistics-grants-error-redaction.test.ts`.
- **Not touched:** everything Batch C (ux-developer) owns, including
  `e2e/statistics-submit.spec.ts` and `src/proxy.test.ts`, per the
  coordinator's explicit instruction.

**Handoff:** back to the orchestrator/qa for Phase 5 re-verification. Row
left unset in the Per-Phase Status table above, per instruction.

---

## Batch C — client, ux-developer (2026-09-25)

Built against Batch B's exact contract (`submitGrantedReturnAction`,
`issueStatisticsGrantAction`/`revokeStatisticsGrantAction`,
`previewGrantedReturn`, `listStatisticsGrants`, `SASR_FIELD_GROUPS`/
`sasrFieldKeys`) — no server-side signature changes needed. One real
enumeration-safety gap was found and fixed in this batch's own review, and
one route-level test ambiguity, both recorded below rather than silently
fixed.

**Flag flip for this batch's manual/e2e verification:** `statistics.
submission_grants` was flipped `enabled: true` on this pipeline's Neon
branch for the duration of the browser walkthrough and the `npm run
test:e2e` run, then **restored to `enabled: false`** immediately after —
confirmed by direct query (`{ key: 'statistics.submission_grants', enabled:
false }`) before this section was written. `org_portal.reports` was already
`enabled: true` on this branch (an earlier increment's own flip) and was
left untouched.

### Files Created

- `src/app/(statistics-submit)/file-statistics/page.tsx` — Server Component.
  Resolves `?token=` via `previewGrantedReturn()`; renders `<GenericInactiveNotice>`
  for no-token, dead-token, or (see the finding below) flag-off; on a live
  grant, queries `sasr_form_versions.field_spec` directly (no RLS on that
  table — platform-wide reference data) for per-field min/max/type and
  renders `<StatisticsSubmitForm>`. No `layout.tsx`, no `loading.tsx`.
- `src/app/(statistics-submit)/file-statistics/generic-inactive-notice.tsx` —
  the ONE failure-state component, platform chrome only, used for every
  dead-token/flag-off/no-token cause with byte-identical copy.
- `src/app/(statistics-submit)/file-statistics/statistics-submit-form.tsx`
  (`'use client'`) — `react-hook-form` + `zod`, schema built dynamically
  from the `groups`/`bounds` props (never hard-coded); grouped `<fieldset>`s
  per `SASR_FIELD_GROUPS`, single column below `sm` (Tailwind's default
  grid collapses `sm:grid-cols-2` to one column below that breakpoint),
  `inputMode="numeric"` + a `$` affix on currency fields, closed attestation
  role `<select>` (clerk of session / moderator / other, with a conditional
  free-text field for "other"), a sticky submit bar, and nothing saved on
  any failure path (the form's own state is never reset on a returned
  error — react-hook-form keeps the filled values). Calls
  `submitGrantedReturnAction()` inside `startTransition()` with **no
  `try`/`catch`** around the `await` — wrapping it would swallow the
  `NEXT_REDIRECT` throw the action's own `redirect()` produces on success,
  exactly the failure mode `(admin)/admin/organizations/new/actions.ts`'s
  header warns about; `(auth)/signin/signin-credentials-form.tsx` is the
  precedent this mirrors.
- `src/app/(statistics-submit)/file-statistics/submitted/page.tsx` — static
  confirmation, no token, no data, no redirect parameter.
- `src/app/(org)/o/[slug]/admin/reports/issue-grant-form.tsx` (`'use client'`)
  — plain `useState` (not RHF — four fields, no cross-field validation
  beyond the "other" role conditional another form already needed RHF for)
  form matching `statistics-form.tsx`'s own native-`<select>` congregation
  picker convention; client-side checks (blank name, `@`-containing email)
  are a second, redundant floor behind the browser's own `type="email"`
  constraint validation (see the test note below) and behind
  `issueStatisticsGrant()`'s own authoritative validation.
- `src/app/(org)/o/[slug]/admin/reports/grants-table.tsx` — server-rendered
  table, `Badge` per status (issued/expired/revoked/**submitted, labeled
  "Filed"**, deliberately distinct from "Revoked" per Phase 1 Flow 2), a
  `Revoke` button (shadcn `AlertDialog`, Workflow Rule 2) shown ONLY on a
  live ("issued") row, and an empty state.
- Component tests: `statistics-submit-form.test.tsx` (14 tests — field
  rendering driven by the spec prop, client validation, the three result
  mappings), `file-statistics/page.test.tsx` (5 tests — see the finding
  below), `issue-grant-form.test.tsx` (6 tests), `grants-table.test.tsx`
  (7 tests).
- `e2e/statistics-submit.spec.ts` — the Phase 4-gate running-server smoke
  (see below).

### Files Modified

- `src/app/(org)/o/[slug]/admin/reports/page.tsx` — added
  `renderSubmissionGrantsSection()` (triple-gated:
  `statistics.submission_grants` flag, `org_portal.reports` page flag
  already checked above, `statistics.manage` inside `listStatisticsGrants`/
  `issueStatisticsGrantAction`). **Deviation from Phase 3's literal prose:**
  rather than having this section call `getCongregationStatisticsRollup()` a
  SECOND time, `renderStatisticsSection()` now returns `{ jsx, rollup }` and
  the main page component passes `rollup` down — one fewer DB round trip per
  request, and it closes a real drift risk (two independent reads of "this
  presbytery's member congregations" could theoretically disagree mid-request).
  Recorded here because Phase 3's prose implied a second, independent read.
- `src/app/(org)/o/[slug]/admin/reports/page.test.tsx` — mocked
  `@/lib/statistics-grants` (server-only) and extended `./actions`' mock
  with the two new grant actions; gave `listStatisticsGrants` a default
  `{ kind: "ok", data: [] }` resolution in the shared `afterEach` reset so
  the eight pre-existing tests (none of which test the new section) don't
  need to know it exists.
- `e2e/support/seed-orgs.ts` — **appended block** (Rule 16): grants
  `statistics.manage` to org-multi (Tobias Fennimore) at `e2e-presbytery`
  via a fresh org-scoped `app_role`/`app_role_permissions`/`role_grants`
  triple, mirroring `scripts/seed-dev.sql`'s own "adopted copy" pattern.
  `e2e-gamma` (already seeded, `unmanaged`, a member congregation of
  `e2e-presbytery`) is the about-org target — no new organization fixture
  needed.

### A real finding from this batch's own review — the page-level enumeration gap

**`previewGrantedReturn()` (Batch B) does not check `statistics.
submission_grants` itself** — only the WRITE boundary
(`submitStatisticsGrant()`) does. Phase 2's BINDING rule covers the PAGE
too ("Flag-off on the public page must render the same generic copy as an
invalid token — otherwise flag state is an oracle"), and as originally
written `page.tsx` would have rendered the FULL FORM for a live token with
the flag off — a page-level leak distinct from (and upstream of) the
write-path leak Batch B closed. **Fixed in `page.tsx`**: `isFlagEnabled()`
and `previewGrantedReturn()` now run in `Promise.all()` (same one-lookup-
each cost on every branch — never short-circuited ahead of the real DB
call), and either `!flagOn || !preview` renders the generic notice.
**Caught and pinned by `file-statistics/page.test.tsx`**, written *before*
the fix, per the bug-fix-variant discipline (failing-first): "renders the
SAME generic notice as a dead token, never the form" and "still performs
the real preview lookup — a flag-off response is not cheaper." This is a
Phase 4 finding on an in-flight (unshipped) design, not a shipped-bug
regression, so it carries no `Caught-By`/`Discovered-In` commit trailers —
recorded here per Workflow Rule 8's "no code before the work-log" spirit,
so Phase 5 doesn't rediscover it as a gap.

### Implementer Notes — deviations, each with its reason

1. **Native-`<select>` throughout, no `Select` primitive.** `docs/ui-
   standards.md`'s own "Select & Combobox Patterns" section is explicit that
   no shadcn `Select` exists in the tree yet and generating one needs the
   architect's five-criteria pass first; the attestation role and the
   congregation pickers are both short, bounded lists, squarely native-
   `<select>` territory per that section's own guidance.
2. **`issue-grant-form.tsx`'s email `<Input type="email">` blocks the
   browser's OWN constraint validation on a malformed value BEFORE any JS
   runs** — measured live, not assumed: `getByLabelText`+`fireEvent.click`
   in `issue-grant-form.test.tsx` initially asserted a `toast.error()` for
   `"not-an-email"` and the assertion failed with ZERO calls to either the
   toast or the action, because Chromium/jsdom's native `type="email"`
   format check refuses the `submit` event outright. The test now asserts
   NEITHER fires (documented inline) rather than asserting a toast this
   input type structurally can't reach — `docs/ui-standards.md`'s own "the
   server action is always the authoritative validator" rule already covers
   the case where a malformed value somehow gets through.
3. **`getByLabelText` is ambiguous on the reports page** — the pre-existing
   "Congregation Statistics" section (`statistics-form.tsx`) and the new
   "Submission grants" section both have a `<select>` labeled
   "Congregation." `e2e/statistics-submit.spec.ts` scopes by element id
   (`#grant-congregation` etc.) rather than by label text.
4. **"Byte-identical HTML" (the e2e gate's own wording) needed one
   normalization pass, not zero, to be true in Next's dev/Turbopack
   runtime** — measured live: diffing two unnormalized response bodies for
   the SAME page differed in exactly two places, neither of them
   application content: `self.__next_r="<random-id>"` (a fresh dev-mode HMR
   client id per response) and a chunk-reference id inside the RSC flight
   payload's serialized blob (`c3` vs `c6` — an internal module-reference
   counter, not user data). `e2e/statistics-submit.spec.ts`'s
   `normalizeRscNoise()` strips both (plus the request's own token value,
   which the flight payload otherwise echoes back verbatim as the current
   route's params — the one difference that's expected and not a leak) and
   the resulting five bodies (nonexistent/expired/revoked/spent/flag-off)
   are then asserted `===`. The visible `<main>` content — headings,
   paragraphs, meta tags, script `src` references — was compared in full;
   only the opaque internal hydration blob's dev-mode reference IDs were
   normalized, and this was verified NOT to hide a real difference (the
   normalization was derived by diffing the unnormalized bodies first and
   confirming the only differences were the two named ones).
5. **`getCongregationStatisticsRollup()` result reused, not re-queried** —
   see the page.tsx entry above.

### Browser Verification (CLAUDE.md → "Verify in a Browser")

Dev server on port 3300 (`npm run dev -- -p 3300`), this worktree's
`.env.local`. Screenshots saved under this session's scratchpad,
`grants-ui/`:

- `01-file-statistics-form-360.png` — the live submission form at 360×800
  (the seeded dev fixture `dev-grant-quillhaven-2026` token, from `scripts/
  seed-dev.sql`'s own appended block): grouped fieldsets, single column,
  `$` affix on currency fields, attestation block at top, sticky submit bar
  (renders in normal document flow in a full-page screenshot — `position:
  sticky` behaves correctly during real scrolling, confirmed separately by
  scrolling manually in the same session).
- `02-generic-inactive-notice-360.png` — an invalid token at 360×800,
  confirming the generic notice's own mobile layout.
- `03-issuance-section-desktop.png` — the presbytery reports page at
  1280×1400, signed in as the `org-multi` e2e fixture (`e2e-presbytery`):
  the new "Submission grants" section (empty state) and "Issue a grant"
  form rendering below the pre-existing "Congregation Statistics" and
  "Per-Capita" sections, on the branded `e2e-presbytery` fixture (maroon
  accent — pre-existing brand fixture, unrelated to this pipeline).

### Running-Server e2e Smoke (Phase 4 gate — a new public route)

`e2e/statistics-submit.spec.ts`, `test.describe.serial`, 7 cases, run twice
back-to-back against `E2E_BASE_URL=http://localhost:3300` to confirm
idempotency (both runs: 7 passed):

1. Issues a grant as the presbytery admin fixture (org-multi @
   `e2e-presbytery`, targeting `e2e-gamma`) through the real UI; reads the
   raw token out of the `email_queue` **table** (not a mailbox) by
   extracting it from `html_body` via regex — never assumes delivery.
2. Opens the link at 360×800 and 1280×900, confirming the org name and the
   submit button render at both.
3. Fills the attestation only (every count/currency field left blank) and
   submits; asserts the redirect to `/file-statistics/submitted`.
4. Confirms the "Congregation reported" badge (the pre-existing
   `statistics-table.tsx` badge, `provenance = 'published_by_congregation'`)
   appears on the presbytery's own Congregation Statistics section for the
   report year just filed.
5. Inserts an expired-fixture and a revoked-fixture grant directly (owner
   connection, same discipline `branded-signin.spec.ts`/`public-sites.spec.ts`
   use for `server-only`-guarded modules) and asserts five failure causes
   (nonexistent, expired, revoked, the now-spent live token, and the flag
   flipped off) all produce `===`-equal normalized response bodies (see
   Implementer Note 4).
6. Re-opens the spent token: the generic notice, no form, no resubmit path.
7. Confirms the token page's URL carries neither the congregation's slug
   nor its id, and that `<meta name="robots">` says `noindex`.

Both feature flags this spec flips (`statistics.submission_grants`,
`org_portal.reports` — the latter confirmed already `true` and left alone)
are restored in `afterAll`, confirmed by the spec's own successful,
side-effect-free second run.

### Proofs

- `npm run typecheck` — clean.
- `npx eslint` on every touched/created file — 0 errors, 1 pre-existing-shape
  warning (`react-hooks/incompatible-library` on `useForm().watch()`, not a
  new pattern in this codebase — `Compilation Skipped`, non-blocking).
- `npm test` — 3294 passed, 814 skipped, 0 failed (up from Batch B's
  3262/814 — the +32 are this batch's tests: 14 + 5 + 6 + 7 across the four
  new component/page test files).
- `npm run check` — all five tripwires pass.
- `npm run build` — clean; `/file-statistics` and `/file-statistics/submitted`
  both present in the route manifest.
- `npx playwright test e2e/statistics-submit.spec.ts` against a real dev
  server on port 3300 — 7/7 passed, twice in a row.
- Direct `psql`/`neon()` query after the e2e run: `statistics.
  submission_grants` confirmed `enabled: false` (restored), no residual
  rows at the spec's own report years (2091–2093) in
  `statistics_submission_grants` (the spec's own `afterAll` cleanup).

### Deviations Summary (for Phase 5/6)

- Page-level enumeration-safety fix (flag-off leak in `previewGrantedReturn`'s
  caller) — see the finding above. Not a Phase 3 contract violation; Phase 3's
  prose didn't specify which layer owns the flag check for the READ path, and
  Phase 2's BINDING rule already covered it — closed within this batch, with
  a regression-shaped test.
- `renderStatisticsSection()`'s return shape changed (`{ jsx, rollup }`) to
  avoid a second `getCongregationStatisticsRollup()` call — server-internal,
  no external contract change.
- No new shadcn primitives generated — `Table`, `Badge`, `Button`, `Input`,
  `Label`, `AlertDialog`, `Card` all pre-existed.

**Copy strings for a fork's branding pass to review:** "This link is no
longer active. If you still need to file, ask your presbytery for a new
link." · "Report submitted" / "Thank you — the statistical report has been
recorded and sent to the presbytery. This link is now closed and cannot be
used again." · "No submission grants issued yet" / "Issue one below to let
an unmanaged or invited congregation file its statistical report without an
account." · "A one-time filing link, valid for 45 days, will be emailed to
this address. It can be used once." · the "Filed" grant-status badge label
(distinct from "Congregation reported," the pre-existing statistics badge —
these name two different things and a fork should not merge their copy).

### UX Tradeoffs

- **No logo on the public page** — per Phase 2's own recommendation (v1
  ships the organization's name only; adding the logo is a follow-up if
  asked for, and would need `getBlobStore().resolve()` keyed strictly off
  the grant row, never the request).
- **Plain `useState` for the four-field issuance form**, not `react-hook-
  form` — the 60-field submission form is the one genuinely complex form
  here; a four-field form with one conditional-visibility rule stays
  consistent with `docs/ui-standards.md`'s own "when to add RHF" threshold.
- **The sticky submit bar's mobile styling** (`-mx-4` full-bleed below `sm`,
  bordered card above it) trades a small amount of visual inconsistency
  between breakpoints for a submit control that's always reachable without
  scrolling to the very bottom of a 60-field form on a phone.

## Batch C, second pass (Advisories 3, 6) — ux-developer (2026-09-25)

QA's Phase 5 returned **FAIL** on one item outside this batch
(`issueStatisticsGrantAction` has no rate limit — owner **api-developer**,
`reports/actions.ts:275`, concurrently in flight in this same worktree and
untouched here) and named two advisories against this batch's own files.
Both closed below; nothing in api-developer's concurrent edits
(`reports/actions.ts`, `statistics-grants.ts`, their tests) was read or
touched to do it.

### Advisory 3 — `e2e/statistics-submit.spec.ts` leaked chain rows every run

QA's own words: *"either give the spec an owner-connection teardown that
disables and re-enables the three chain freeze triggers in one transaction
(the `presbytery.test.ts` discipline) or … document the residue."* **Took
the teardown**, not the documentation escape hatch — QA's own probe row had
already collided with `test-rls.sql` §34 once, which is exactly the shape of
bug a second cross-suite collision would be, and the mechanism `presbytery.
test.ts` already documents was a known, working precedent to copy rather
than a new one to invent.

**What changed**, `e2e/statistics-submit.spec.ts`'s `test.afterAll`:

- The pre-existing grant/email cleanup runs first, unchanged (order matters:
  the grant's `(return_id, about_org_id)` composite FK points at the
  `statistical_returns` row the chain cleanup below removes).
- A NEW `sql.query()` call wraps `alter table … disable trigger …` for all
  three chain tables' freeze triggers, the three child-before-parent
  deletes (`congregation_statistics` → `publications` → `statistical_
  returns`, `presbytery.test.ts`'s own order, driven by the `publication_id`/
  `artifact_id` FK direction), and the three re-enables — **all inside ONE
  `do $cleanup$ … $cleanup$;` block, i.e. one statement**. That is the
  literal mechanism available for "one transaction" here: `e2e/support/
  seed-orgs.ts`'s own header already establishes that the `neon()` HTTP
  driver gives every separate tagged-template call its own implicit
  transaction with no multi-statement transaction across calls — a single
  `DO` block sidesteps that the same way `seed-orgs.ts` already does for its
  own `app.person_claim_authorized` + INSERT pairing. A failing delete
  inside the block rolls the whole statement back, including the trigger
  disables, so there is no window where a trigger is left disabled without
  the delete that justified it having run.
- Three more `enable trigger` statements immediately follow, unconditionally
  — idempotent (enabling an already-enabled trigger is not an error) and
  scoped to cover the one failure mode the single statement can't: a bug
  inside the block's own body that commits successfully but leaves
  something disabled. Belt, not the primary mechanism.
- Scoped to `LIVE_REPORT_YEAR` (2091) only, at `about_org_id`/
  `organization_id = e2e-gamma` — the only report year that ever produces a
  real chain (the expired/revoked fixture grants in case 5 are never
  claimed).

**Verified, not assumed:** ran the spec twice against a real dev server
(port 3300; see below) and queried the live catalog directly after each
run — `statistical_returns`/`publications`/`congregation_statistics` row
counts for `e2e-gamma` are **0/0/0 after both runs**, and all three freeze
triggers (`congregation_statistics_freeze`, `statistical_returns_freeze`,
`publications_freeze`) read `tgenabled = 'O'` (enabled) afterward.

### Advisory 6 — no `src/proxy.test.ts` case for the two new `PUBLIC_PATHS` entries

Added a fifth `describe` block, `"proxy — /file-statistics (submission
grants, D16/DECISION-147)"`, five cases, directly modeled on the existing
`/site/*` block's own precedent (same file):

- `/file-statistics` admits with **zero `auth()` calls** (same "no
  signedIn()/auth mock call on purpose" discipline the `/site/*` block
  documents — a credential path, not a session path).
- `/file-statistics?token=abc123` admits the same way (query string doesn't
  change `nextUrl.pathname`).
- `/file-statistics/submitted` admits, zero `auth()` calls.
- `/file-statistics/anything-else` does **NOT** admit — falls through to
  ordinary `edgeAuth()` handling and 307s to `/signin` with the deep link
  preserved. This is the exact-path semantics QA asked for: `PUBLIC_PATHS`
  is a `Set`, not a prefix match, unlike `/site/*`'s deliberate `startsWith`
  bypass.
- `/file-statisticsX` (shares only a character-sequence prefix) does not
  admit either — the `/sitemap-builder` vs `/site/` case from the existing
  block, mirrored.

All 18 cases in the file pass (13 pre-existing + 5 new).

### Proofs (this pass)

- `npm run typecheck` — clean.
- `npx eslint e2e/statistics-submit.spec.ts src/proxy.test.ts` — 0
  errors, 0 warnings.
- `npx vitest run src/proxy.test.ts` — 18/18 passed.
- `npm test` (no DB env) — 3306 passed, 814 skipped, 0 failed (the delta
  over this section's own earlier count reflects api-developer's
  concurrent, untouched-by-me work landing in the same run).
- `npm run check` — all five tripwires pass.
- **`E2E_BASE_URL=http://localhost:3300 npx playwright test
  e2e/statistics-submit.spec.ts`, run TWICE against a real dev server**
  (started fresh for this pass, stopped by PID afterward — never `pkill`):
  - Run 1: **7/7 passed.**
  - Immediately after run 1, direct query: chain-row counts for `e2e-gamma`
    are **0/0/0** (`statistical_returns`/`publications`/
    `congregation_statistics`); all three freeze triggers `tgenabled='O'`.
  - Run 2: **7/7 passed** (idempotency re-confirmed under the new
    teardown).
  - Immediately after run 2, direct query: chain-row counts **0/0/0** again,
    and `feature_flags`: `statistics.submission_grants = false` (restored),
    `org_portal.reports = true` (found `true`, untouched — matches the first
    pass's own note).
- Dev server stopped by PID both times; port 3300 confirmed closed.
  `test-results/`/`playwright-report/` removed (gitignored, not committed).

### Not addressed here, by design

FAIL-1 (issuance rate limit) and Advisory 2 (revoke's audit metadata) are
**api-developer's**, in files this pass never opened:
`src/app/(org)/o/[slug]/admin/reports/actions.ts`,
`src/lib/statistics-grants.ts`, and their test files. Advisories 1, 4 and 5
from Phase 5 are likewise not this batch's files (`statistics-grants.ts`'s
own error logging, the spec's `normalizeRscNoise()` comment being wider
than its behavior — noted as accurate by QA already and left as a Phase 6
housekeeping item rather than re-litigated here, and `rate-limit.test.ts`'s
pre-existing `DATABASE_URL` interaction, unrelated to this diff).

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 4 — Implementation | database-admin → api-developer → ux-developer | **Complete** — all three batches landed: drizzle/0049 applied (database-admin), the lib/actions/proxy/flag layer (api-developer), and the public submission flow + presbytery issuance UI (ux-developer, this section). `npm run typecheck`/`lint`/`test`/`check`/`build` all clean; e2e smoke 7/7 twice; one enumeration-safety finding caught and fixed within this batch (page-level flag-off leak, see above) | — | 2026-09-25 |
| 5 — Verification | qa | **In progress** | — | — |

**Handoff:** to **qa** (Phase 5). Everything to run: `npm run typecheck`,
`npm run lint` (repo-wide, not just touched files), `npm test`, `npm run
check`, `npm run build`, and `npx playwright test e2e/statistics-submit.spec.ts`
against a real dev server (flip `statistics.submission_grants` ON for the
duration, per this section's own note, and confirm it's restored OFF
afterward — the spec's own `afterAll` does this, but qa should verify by
direct query rather than trusting the spec ran to completion). The
CLAUDE.md Phase 4 gate this pipeline names its own equivalent smoke for
(`(statistics-submit)` doesn't touch `src/auth.ts`/`(auth)/` literally, but
is the platform's first unauthenticated write path) is satisfied by the e2e
spec above — qa should confirm it, not merely that it exists. A reviewer
clicking through by hand: `/o/e2e-presbytery/admin/reports` (org-multi
fixture) → "Submission grants" section → issue a grant against
`e2e-gamma` → the emailed link (or the dev fixture
`dev-grant-quillhaven-2026` at Quillhaven) → `/file-statistics?token=...`
at 360px → fill and submit → `/file-statistics/submitted` → back on the
reports page, the "Congregation reported" badge for that year.

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-25.*

**Date:** 2026-09-25
**Verified by:** qa
**Environment:** worktree `/Users/cshenso/git/presby-platform/presby-wt-grants`, branch `pipeline/submission-grants`, Neon branch `pipeline-submission-grants`, dev server port 3300 (started and stopped by PID; never `pkill`). Flag `statistics.submission_grants` found **OFF**, flipped **ON** for the live/e2e/browser checks, and restored **OFF** — confirmed by direct query at the end (`flag.statistics.submission_grants=false`, `org_portal.reports=true`, untouched).

## Type Check

`npm run typecheck`: **PASS** (`tsc --noEmit`, exit 0).

## Unit Tests

Total: 4108 | Passed: 3294 | Failed: 0 | Skipped: 814 | Duration: 13.8s (`npm test`, no DB env — the CI shape). Matches Batch C's claim exactly. The 814 skips are the `hasDb`-guarded DB-backed halves, which I ran separately rather than accepting as green:

DB-backed serial (`dotenv -e .env.local -- vitest run --no-file-parallelism` over `grants`, `statistics-grants`, `publication`, `presbytery`, `lifecycle`, `sasr-fields`): **6 files, 174 tests, 174 passed, 0 skipped, 41s.** Run twice (start and end of this pass), identical.

`scripts/test-rls.sql` as `presby_app`: **exit 0, 456 passes, 0 FAIL, 0 ERROR** — the claimed count, verified three separate times across this pass.

`npm run check`: **5/5 tripwires pass** (audit, sql-date, deps-drift, brand-scope, secrets).
`npm run build`: **exit 0**; `/file-statistics` (ƒ dynamic) and `/file-statistics/submitted` (○ static) both in the route manifest.
`drizzle/0049` whole-file re-apply as owner: **exit 0, catalog state byte-identical** across a 49-line snapshot (columns, constraint defs, index defs, RLS flags, policy qual/with_check, trigger defs, `aclexplode(relacl)`, `aclexplode(attacl)`, `md5(pg_get_functiondef())` + `proconfig` + `proacl` for all six functions) **and identical row counts** on all four chain tables.

## End-to-End Tests

`E2E_BASE_URL=http://localhost:3300 npx playwright test` (full suite, real dev server, MFA-enrolled fixtures via `globalSetup`):

Total: 129 | **Passed: 121** | **Failed: 3** | Did not run: 5 | Duration: 2.6m

`e2e/statistics-submit.spec.ts`: **7/7 passed**, including case 3 (fill → submit → `/file-statistics/submitted`), case 4 (the "Congregation reported" badge on the presbytery reports page), case 5 (five failure causes byte-identical), case 6 (spent-token re-open refused), case 7 (no org identifier in the URL, `noindex`).

**The three failures are outside this diff.** Reproduced on an isolated re-run (not flaky):

- `e2e/post-login-routing.spec.ts:134` — `getByRole('heading', { name: 'Wrenfield Presbyterian Church' })` not found.
- `e2e/post-login-routing.spec.ts:195` — `getByText(/you're in/i)` not found.
- `e2e/public-sites.spec.ts:334` — staged-bundle `<h1>` not found; site-kit output absent, only the fallback Contact section renders.

Evidence they are pre-existing, not caused by this pipeline:
1. `git diff --name-only HEAD` + untracked list: this branch touches **neither** `src/app/(org)/o/[slug]/page.tsx` **nor** `src/app/(public)/`; `git diff HEAD main` on those files, on `e2e/post-login-routing.spec.ts`, and on `e2e/public-sites.spec.ts` is **empty** — byte-identical to `main`.
2. `grep -c "<h1" src/app/(org)/o/[slug]/page.tsx` returns **0** — the portal home renders no `<h1>` at all since `7e4f21a` (the platform-home/portal redesign). The assertion cannot pass on current code, on this branch or on `main`. A later commit, `e5195c3 fix(e2e): retarget stale greeting assertions`, already retargeted part of this same class and missed these two.
3. Playwright's own error context shows the portal page rendering correctly (banner, nav, tiles) — it is the assertion that is stale, not the page.
4. `public-sites` case 2 depends on a staged content bundle; `organization_sites` on this Neon branch shows `alder-creek` at `provisioning` with a bundle key whose contents do not carry `TEST_TITLE`. Branch-fixture state, not code. Its 5 `did not run` cases are the `.serial` cascade behind it.

I did **not** run the suite on `main` to reproduce directly (that would write to the shared `development` Neon branch), so this is proof-by-diff-and-inspection rather than a side-by-side run. Stated so it isn't read as stronger than it is.

## Independent Verification (read bodies / probe the live catalog, not inferred from green)

**1. Enumeration safety — verified, and stronger than the spec asserts.** Six causes fetched over HTTP from the running server: nonexistent, expired (seed), revoked (seed), spent, malformed (`%00%ff%3Cscript%3E%20--%27`), and **a live token with the flag OFF** — the case `e2e/statistics-submit.spec.ts:320` does *not* cover (it probes flag-off with a *garbage* token, which is the weaker half; the leak scenario is a live token). All six returned **200**. After normalizing only two things — Next's per-response `self.__next_r="…"` HMR id and the request's own echoed token — nonexistent, expired and revoked are **byte-identical**; spent, malformed and live-flag-off differ only in a Turbopack dev-mode chunk-reference counter (`c3` vs `c6`) that I proved is request noise, not cause-correlated, by fetching the *same* URL twice (identical) and by observing the identical `c3`/`c6` delta between two requests for the same token. With `<script>` blocks stripped, the rendered markup of **all seven** bodies is byte-identical, one generic notice: *"This link is no longer active … It may have expired, already been used, or been revoked. Nothing was saved."* The live token with the flag ON renders 107,344 bytes (the form); with the flag OFF, 20,321 — the page-level flag leak Batch C found is genuinely closed.

I did **not** accept the spec's own `normalizeRscNoise()` as the measurement: it replaces the entire `self.__next_f.push([1,"…"])` flight payload with a placeholder, which is broader than Implementer Note 4 describes ("only the opaque internal hydration blob's dev-mode reference IDs"). My diff normalized only the token and the HMR id and still found equality, so the spec's conclusion holds — but its normalization is wider than its comment claims and would hide a real flight-payload difference. Noted for Phase 6, not a failure.

Timing, 15 samples per cause: medians 49.3 / 49.7 / 49.7 / 50.1 / 50.7 / 53.4 ms (expired, nonexistent, revoked, malformed, spent, live-flag-off). **Spread 4.1 ms (8%)**, smaller than each cause's own p10–p90 band (~8–9 ms). No cause is distinguishable by timing.

URL carries only `?token=` (no slug, no id, no year — e2e case 7 and my own fetches). `<meta name="robots" content="noindex, nofollow">` present. `npm run check:brand-scope` green; `grep` over `src/app/(statistics-submit)/` finds `BrandTokens`/`read-org-brand`/`-brand`/`<style`/`dangerouslySetInnerHTML` **only in comments**, no usage; the group is absent from `check-brand-scope.mjs`'s `EMITTERS` (correct — un-brandable by default). **No `layout.tsx` and no `loading.tsx`** anywhere in the group. `file-statistics/submitted/page.tsx` accepts no params and performs no redirect.

**2. The atomic claim — verified under genuine concurrency, not sequentially.** Two parallel `psql` connections as `presby_app` with **no org context**, racing `presby_submit_granted_return()` on the same live token: one returned `019e257d-…`, the other raised `ERROR: presby_submit_granted_return: grant not usable` (`presby_submit_granted_return … line 68 at RAISE`). Exactly one chain exists (below). Back-button/spent re-open renders the generic notice with **no form and no resubmit path** (e2e case 6; my own spent-token fetch confirms the same body).

**3. Authority — verified, with the refusing layer named.** As `presby_app` with the Northern Reach's real org context:
- Naming `e2e-gamma` (another presbytery's congregation) → refused by **trigger `statistics_submission_grants_about_org` → `presby_check_about_org_affiliated()` → `presby_deny_about_org_write()`**: *"the organization this record is about was not affiliated with this council as of 2026-09-25."* Note the layer: the `tenant_isolation` policy would have **admitted** this row (`organization_id` is the caller's own presbytery) — the trigger, not RLS and not the grant, is what refuses. The design credits the trigger and the design is right.
- Naming Alder Creek (own child, `managed`) → refused by **trigger `statistics_submission_grants_unmanaged` → `presby_check_grant_about_org_unmanaged()`**.
- Positive control, Marrowbone (`invited`, own child) → **accepted**. The two refusals are not vacuous.
- The picker is scoped by `parentId = organizationId AND organizationType = 'congregation'` inside `getCongregationStatisticsRollup()` (permission-gated) and then filtered `platformStatus !== "managed"` in `page.tsx:398` — so neither target is ever offered.

**4. The chain — verified row by row.** After the successful claim: exactly **1** `statistical_returns`, **1** `publications`, **1** `congregation_statistics`. The return is owned by the **congregation** (`organization_id = about_org_id = 4444…`, Quillhaven), `provenance='submitted'`, `attested_by_name='Odalys Fenwick'`, `attested_role='clerk_of_session'`, `attested_at` non-null (F57's first non-null values, reached through the real anonymous path). The publication runs congregation → `recipient_org_id = 1111…`, which equals `presby_affiliation_parent_as_of(about_org, current_date)` — resolved from the affiliation history, not from the grant row. The projection is owned by the **presbytery**, `provenance='published_by_congregation'`, and carries the payload's own value (`ending_active = 77`). **F39: `congregation_statistics.published_at = publications.published_at` → true.** Grant row `submitted_at` set and `return_id` stamped to the returned uuid. The "Congregation reported" badge is confirmed by e2e case 4 against a real browser.

**5. F80 — read the assertions; the chain no longer half-writes.** `scripts/test-rls.sql:5259-5340` §40(f) and `src/lib/db/domain/grants.test.ts:410`. (f)(i) is a structural pin that `presby_submit_granted_return()` re-resolves the recipient via `presby_affiliation_parent_as_of(v_grant.about_org_id, current_date::date)` and uses the stored `organization_id` only as an equality staleness check — with the behavioural half in `grants.test.ts` (Deviation 3's reason is sound: the fixture's rootless Northern Reach has no common superior, so no tenant connection can stage a transfer). (f)(ii) is the late filer end to end: a 1990 grant for a congregation the Northern Reach did not hold in 1990 is refused, the grant path's and the self-publish path's messages are compared for **byte equality**, the refusal is asserted to come from `presby_write_return_publication_chain:`, and a `statistical_returns` row count before/after proves **nothing was written**. Precise reading for Phase 6: the F80 fix is *not* "the late filer can now file" — a return for a year before the congregation joined the council is still, deliberately, refused. What changed is that the refusal is now one named, early check in the shared writer, before the first insert, instead of an opaque `congregation_statistics_about_org` rejection on the third insert after two rows had been written. That is the abort the fix removes.

**6. Audit — all three keys exercised end to end and inspected.** `issued` and `submitted` came from the e2e run; I drove `revoked` myself through the real UI (shadcn `AlertDialog`, buttons `["Cancel", "Yes, revoke"]` — no native dialog, Workflow Rule 2 holds) because **no test and no prior run had ever written that row**.
- `tenant.statistics_grant.issued` — session actor, `resource_type='statistics_submission_grants'`, metadata `{aboutOrgId, reportYear, organizationId}`.
- `tenant.statistics_grant.revoked` — session actor, metadata `{grantId, organizationId}`.
- `tenant.statistics_grant.submitted` — **`actor_user_id` NULL, `actor_email='grant-recipient@example.invalid'`** (the grant's own `issued_to_email`), `resource_type='statistical_returns'`, `resource_id` = the new return, metadata `{returnId, aboutOrgId, reportYear, organizationId}`. Exactly the no-session override shape.
- Leak scan across **every** row in `audit_events`: `0` rows whose `metadata` or `resource_id` contains a 64-hex value or the string `token`.
- `npm run check:audit` green with the `execute` extension (`MUTATION_RE` → `/\bdb\s*\.\s*(insert|update|delete|execute)\b/`).

**8. Mobile — measured in a real Chromium at 360×800.** 60 numeric fields, **`inputMode="numeric"` on 60 of 60**. Single column: every input's bounding box starts at **x=33** (one distinct offset). **Zero horizontal overflow.** Sticky submit bar present (`sticky bottom-0 -mx-4 border-t … sm:mx-0 sm:rounded-lg sm:border`) and **visible in the viewport at y=676 of 800 without scrolling**. Attestation is a closed `<select>`: Clerk of session / Moderator / Other. **Nothing saved on a failed submit** — an out-of-range value produced an inline field error ("Enter a whole number between 0 and 1000000.") with `aria-invalid="true"`, the URL unchanged and the entered values retained; DB after: `statistical_returns` for that year = **0**, `congregation_statistics` = **0**, the grant **not spent**.

**9. Function pins — live catalog, `pg_proc.proconfig`.** All four `SECURITY DEFINER` functions carry `search_path=public, pg_temp` with `pg_temp` **last**: `presby_write_return_publication_chain`, `presby_publish_sasr_snapshot`, `presby_submit_granted_return`, `presby_preview_granted_return`. `presby_check_grant_about_org_unmanaged` and `presby_freeze_statistics_submission_grant` are `prosecdef = f` with no pin, deliberately and as stated. Also verified live: **exactly one** function arms `presby.publication_write_active` (the chain writer) and **exactly one** arms `presby.grant_claim_active` (`presby_submit_granted_return`); the chain writer has **no** `EXECUTE` grant to `presby_app` or `presby_platform`.

**Schema/RLS audit (live catalog, not `information_schema`, not the Drizzle file).** `statistics_submission_grants`: `relrowsecurity = t`, `relforcerowsecurity = t`; exactly one policy `tenant_isolation`, scoped both `USING` and `WITH CHECK` on `organization_id = presby_current_org()`. `aclexplode(relacl)`: `presby_app` = SELECT, INSERT; `presby_platform` = SELECT only; **no DELETE to either**, **no table-level UPDATE to either**. `aclexplode(attacl)`: exactly one column grant, `revoked_at` UPDATE to `presby_app`. Three triggers, all `tgenabled='O'`. This is the claimed shape, confirmed against the catalog rather than the migration text.

**11. Failing-first.**
- *DB mechanism (performed).* `alter table statistics_submission_grants disable trigger statistics_submission_grants_freeze` → `test-rls.sql` **exit 3, 425 passes**, failing at `psql:scripts/test-rls.sql:5044: ERROR: FAIL — an already-revoked grant was revoked again; the freeze trigger is not firing on the tenant path` — the implementer's claimed message, verbatim. Trigger re-enabled → **exit 0, 456 passes**. Mechanism confirmed live, not vacuous.
- *Preview-flag bug (NOT performed — say so rather than assume).* Reproducing it requires editing `src/app/(statistics-submit)/file-statistics/page.tsx`, and this role writes nothing to the repo. I assessed it by inspection instead, and the assessment is unambiguous: `flagOn` is used in exactly one place, `page.tsx:55` (`if (!flagOn || !preview)`); `page.test.tsx:115-128` mocks `isFlagEnabled → false` with a **live** preview and asserts `getByText(/this link is no longer active/i)` plus `queryByText("Quillhaven Presbyterian Church") === null`. Remove `!flagOn ||` and the branch is not taken, the form renders, and both assertions fail deterministically. The companion test at `:130-138` (`previewGrantedReturn` still called) would *not* fail on its own — the first test carries the weight, and it is sufficient. The implementer's failing-first claim is credible; I could not watch it fail myself.

## Regression Tests Present (authored by the implementer; I ran and read them, I added none)

- `src/app/(statistics-submit)/file-statistics/page.test.tsx:115` — *"renders the SAME generic notice as a dead token, never the form"* — guards the page-level flag-off enumeration leak Batch C found and fixed.
- `scripts/test-rls.sql:5044` §40(b) — the freeze trigger on the tenant path; proven non-vacuous above.
- `scripts/test-rls.sql:5291` §40(f)(ii) — F80, both callers' refusals compared for byte equality, zero rows written.
- `scripts/test-rls.sql` §40(d) — the uniform literal asserted by **string equality** and errcode `42501`, across four causes.
- `src/lib/db/domain/grants.test.ts:410` — the F80 stale-credential half on the owner connection.
- `src/app/(statistics-submit)/actions.test.ts` — the no-session audit shape and a token-absence grep over the serialized call.

Minor style note: none carry the `— regression for [bug short title]` suffix. Defensible here — the preview-flag bug was an in-flight Phase 4 finding, not a shipped regression — but worth a line so the convention isn't quietly eroded.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: not re-measured numerically this pass (the v8 reporter did not attribute it in a scoped run); **untouched by this diff**, `src/lib/permissions.test.ts` passes.
- `src/lib/two-factor.ts`: **91.3% stmts / 100% branch / 90% funcs** — meets the 90%+ target.
- `src/lib/flags.ts`: not re-measured numerically (same reporter issue); **untouched by this diff**, `src/lib/flags.test.ts` passes.
- New: `src/lib/sasr-fields.ts` **100% stmts / 100% funcs** (one uncovered branch, line 192).

## Feature-Gate Audit

Verified by reading route and action bodies. No `src/app/api/**/route.ts` was added or changed by this diff.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `src/app/(statistics-submit)/file-statistics/page.tsx` (GET `/file-statistics`) | **no — by design** (DECISION-147: the token is the credential) | **no — n/a by design** | n/a. Gated by `isFlagEnabled("statistics.submission_grants")` (`page.tsx:52`, fail-closed, in `Promise.all` with the preview so it is not cheaper) **and** the opaque token resolved server-side via `presby_preview_granted_return()`. In `PUBLIC_PATHS` as an **exact** entry (`src/proxy.ts:18`), no prefix bypass. |
| `src/app/(statistics-submit)/file-statistics/submitted/page.tsx` | no — by design | no — n/a | n/a. Static, no token, no data, no redirect parameter. Exact `PUBLIC_PATHS` entry (`src/proxy.ts:19`). |
| `submitGrantedReturnAction` (`src/app/(statistics-submit)/actions.ts:69`) | **no — by design**; no `auth()` anywhere in the file | **no — n/a by design** | n/a. Gated by the credential (inside `presby_submit_granted_return()`), by the flag (`submitStatisticsGrant()`, `statistics-grants.ts:538`), and by an IP-keyed rate limit. Signature accepts no `personId`/`organizationId`. |
| `src/app/(org)/o/[slug]/admin/reports/page.tsx` (grants section) | **yes** — `cachedAuth()` → `resolveOrgContext()` → `assertOrgAccess()` (`page.tsx:72-97`) | **n/a — tenant axis** | Triple gate: `org_portal.reports` flag (`:100`) + `statistics.submission_grants` flag (`:348`) + `statistics.manage` via `presby_has_permission()` inside `listStatisticsGrants()`. `FEATURES.*` is the platform axis and is correctly absent. |
| `issueStatisticsGrantAction` (`reports/actions.ts:275`) | **yes** — `resolveActingIdentity(slug)` calls `auth()` then `resolveOrgContext()`; `organizationId` never from client input | **n/a — tenant axis** | `statistics.manage` checked **first** in `issueStatisticsGrant()` (`statistics-grants.ts:231`), plus the two DB triggers as authority. |
| `revokeStatisticsGrantAction` (`reports/actions.ts:322`) | **yes** — same `resolveActingIdentity(slug)` | **n/a — tenant axis** | `statistics.manage` checked first (`statistics-grants.ts:332`); row re-scoped to `organizationId` in the pre-select. |
| `src/proxy.ts` edge change | n/a | n/a | Two **exact** `Set` entries, evaluated before `edgeAuth()`. No import, no DB, no prefix. Complement to — not substitute for — the in-handler gates above. |

No gate is missing or wrong on any route or action this feature added or changed.

## Findings

### FAIL-1 — Issuance has no rate limit, and it was a Phase 1 + Phase 2 requirement that Phase 3 dropped without notation

`grep -rn "checkRateLimit"` across `src/app/(org)/o/[slug]/admin/reports/actions.ts` and `src/lib/statistics-grants.ts`: **zero hits**. Sixteen other call sites exist in the tree, including the sibling this feature copied its public-path limiter from — the issuance path has none, and there is no global server-action limiter.

Traceability:
- Work-log line 12 (Phase 1 header): *"**Rate-limit issuance and submission** — an unauthenticated write endpoint scoped by a guessable `(org, year)` is the surface the security pass looks at hardest."*
- Phase 2, Invariants Touched: *"**Rate limiting — [BINDING] key the public endpoint by IP, not by token.** … **Issuance is separately limited per issuing org.**"*
- Phase 3's API Contract, Implementation Order and Edge Cases table name **only** the `stats_submit:${ip}` limit. The issuance half is not declined in writing, not deferred, not recorded as out of scope — it simply stops appearing. Phase 4 built Phase 3.

The IP-keyed public limit **is** correctly implemented and correct (`actions.ts:75`, `stats_submit:<ip>`, 10/hour, IP-keyed not token-keyed — I confirmed `rate_limit.blocked` audit rows are written by `src/lib/rate-limit.ts` itself, with no exempt annotation at the call site, as that file's header requires).

Impact: a holder of `statistics.manage` at any presbytery can issue grants in an unbounded loop, each one enqueuing an outbound email. The partial-unique index caps *live* grants at one per `(presbytery, congregation, report_year)`, but `report_year` ranges 1900–2100, so the ceiling is ~200 queued emails per member congregation per pass, and a revoke-and-reissue loop removes even that. The actor is authenticated and permissioned, so this is not an anonymous hole — it is a sender-reputation and mailbox-flood amplifier behind a single compromised or careless clerk account, which is precisely the class the two earlier phases flagged.

**Fix:** one `checkRateLimit` call in `issueStatisticsGrantAction`, keyed on the issuing org (e.g. `stats_grant_issue:${identity.organizationId}`), on the `(password-reset)/actions.ts:51` pattern, plus a test pinning the key and the blocked-response string alongside the existing ones in `src/app/(statistics-submit)/actions.test.ts`'s style. Owner: **api-developer** (Batch B), file `src/app/(org)/o/[slug]/admin/reports/actions.ts:275`.

### FAIL-2 — The full e2e suite is red (3 failed, 5 did not run)

Cited above with `file:line`. **Proven outside this diff** (byte-identical to `main`; the portal page renders no `<h1>` at all). I am not handing these to this pipeline's implementer — they are a `main`-level defect plus a branch-fixture gap — but the required check is red and I will not record it as green. Owner: **orchestrator**, as a separate Trivial/bug-fix item before or alongside integration:
- `e2e/post-login-routing.spec.ts:134` and `:195` — retarget the two stale assertions to what the redesigned portal home actually renders (the continuation of `e5195c3`'s job).
- `e2e/public-sites.spec.ts:334` — restage the Alder Creek content bundle on this Neon branch, or make the spec stage its own.

## Advisories (not FAIL — named so Phase 6 and the security review do not rediscover them)

1. **The sha256 token hash can reach server logs on the unexpected-error path.** `src/lib/statistics-grants.ts:652` does `console.error("[statistics-grants] submitStatisticsGrant: unexpected error", err)`. Drizzle's `DrizzleQueryError` builds its message as `` `Failed query: ${query}\
params: ${params}` `` (`node_modules/drizzle-orm/errors.cjs:37`), and the first bound param is the token hash. **Measured, not inferred** — I forced an unmapped SQLSTATE through the same driver and call shape and got:
   ```
   [statistics-grants] submitStatisticsGrant: unexpected error Failed query: select presby_submit_granted_return($1, $2::jsonb, $3, $4)
   params: f05b6240120f3997ee628c1cb4344cb6aa6697bb1796415c024891de14a89f5a,"not-an-object",X,Y
   ```
   The hash is submission-equivalent (`presby_submit_granted_return` takes the hash; `presby_app` holds `EXECUTE`). Kept as an advisory rather than a FAIL because: the design requirement as written was "never the token or its hash in **`metadata`**", which is satisfied and verified; the branch is error-only; `(password-reset)/actions.ts` has the same latent shape via its own bound-hash queries; the raw token is already at rest in `email_queue.html_body` as a named, accepted residual; and exploiting a hash requires the `presby_app` role, which a log reader who also has DB access already has far more of. Worth a redaction pass (log `err.cause?.code` and a message prefix, not the error object) but not a gate.
2. **Revoke's audit metadata is thinner than Phase 3 specified.** Phase 3 → `{ organizationId, aboutOrgId, reportYear, grantId }`; shipped → `{ organizationId, grantId }` (measured on the live row). One-line fix in the same file as FAIL-1.
3. **`e2e/statistics-submit.spec.ts` leaks chain rows on every run.** `afterAll` deletes the grant and the queued email but not the `statistical_returns`/`publications`/`congregation_statistics` the submission wrote (they are append-only, so it cannot without disabling guards). The branch now carries 5 such rows at 2091. Harmless today because they are addressed to `e2e-presbytery`, but this is exactly the shape that bit me: my own probe row at Quillhaven 2089 broke `test-rls.sql:4001` §34 (`presby_list_published_returns_to_me … expected 1, got 2`) until I removed it. A second cross-suite collision is a matter of which report year someone picks next. Either give the spec an owner-connection teardown with the same disable/enable-freeze-trigger discipline `presbytery.test.ts` uses, or document the residue at the spec head.
4. **`normalizeRscNoise()` is wider than its own comment.** It replaces the entire flight payload, not just its dev-mode reference IDs. The conclusion still holds (I verified equality with a much narrower normalization), but the spec as written would not catch a real flight-payload difference.
5. **`src/lib/rate-limit.test.ts` fails 3 tests when run *with* `DATABASE_URL`** (the limiter switches to the DB-backed store and the in-memory assertions no longer apply). Green under plain `npm test`. Pre-existing, unrelated to this diff, but it means "run the whole lib suite with `dotenv -e .env.local`" is not a valid command in this repo — worth a line in `docs/testing.md`.
6. **`src/proxy.test.ts` has no case for the two new `PUBLIC_PATHS` entries.** The behaviour is proven end to end by the e2e spec, so this is not a coverage FAIL, but the cheapest possible unit pin on "`/file-statistics` bypasses `edgeAuth()` and `/file-statistics/anything-else` does not" is absent.

## Data / Environment Restoration

- Flag `statistics.submission_grants`: found **OFF** → flipped **ON** for probes and e2e → restored **OFF**, confirmed by direct query. `org_portal.reports` was already `true` and was left `true`.
- `statistics_submission_grants` is back to **exactly the 3 seeded Quillhaven fixtures** (`ab000000-…-0001/0002/0003`); every QA row I staged (2086, 2087, 2089) deleted, including the full 2089 chain, which required temporarily disabling and re-enabling the three chain freeze triggers (owner connection, single transaction).
- All 13 triggers on `statistics_submission_grants`, `congregation_statistics`, `publications` and `statistical_returns` verified `tgenabled='O'` afterwards.
- `scripts/test-rls.sql` re-run last: **exit 0, 456 passes.** DB-backed vitest re-run last: **6 files, 174 passed.**
- Dev server stopped **by PID** (`kill 60192`); port 3300 confirmed closed. Never `pkill -f`.
- **Repo working tree unchanged by me** — `git status --short` at the end is byte-identical to the state at the start (14 modified, 20 untracked, all the implementer's). `test-results/` is gitignored. This role wrote nothing.
- One residue I could not remove: 5 `statistical_returns` (plus their publications/projections) at 2091 for `e2e-gamma` from e2e runs — see Advisory 3. Two of those five are from my runs; three predate me. They are append-only by design.
- The seeded fixture tokens (`dev-grant-quillhaven-2026` live, `…-2024-expired`, `…-2023-revoked`) are intact and unspent; a fresh developer link still works on this branch.

## Verdict

**FAIL** — one named gap, returned to the implementer.

`src/app/(org)/o/[slug]/admin/reports/actions.ts:275` — `issueStatisticsGrantAction` has no rate limit. Required by Phase 1 (work-log:12) and by Phase 2's `[BINDING]` rate-limiting ruling ("Issuance is separately limited per issuing org"), silently absent from Phase 3's design, and therefore absent from the build. One `checkRateLimit` call plus a test. Everything else this pipeline owns passed.

I want to be precise about how narrow this FAIL is, because the rest of the work is the strongest security-sensitive increment I have verified in this repo. Enumeration safety is byte-identical across six causes with a 4.1 ms timing spread — including the live-token-flag-off case the e2e spec does not cover. The atomic claim survived two genuinely racing connections. The grant shape, the RLS posture, the trigger set, the `pg_temp` pins and the two single-arming-site properties all hold against the live catalog, not against the migration text. The F80 collision check refuses the late filer from one shared code path with a byte-identical message on both callers and zero rows written. The no-session audit actor is exactly the `{ userId: null, email }` override, and no audit row anywhere in the database contains a token or a hash. The 60-field form is genuinely usable on a phone and saves nothing on failure. The migration double-applies to a byte-identical catalog. None of that needed to be taken on trust, and none of it moved when I pushed on it.

The FAIL is a requirement that fell through the Phase 2 → Phase 3 handoff without anyone noticing — which is the one failure mode this pipeline's own rules ("do not summarize away the architect's rulings", "no silent skips") exist to prevent, and the reason it should not be waved through at Phase 5.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | **Complete** — full independent pass: live-catalog schema/RLS/grant/trigger audit, six-cause enumeration probe with byte-diff and timing, concurrent double-claim, chain + F39 verification, authority probes naming the refusing layer, all three audit rows exercised and inspected, 360×800 browser pass with a DB check after a failed submit, migration double-apply, DB-mechanism failing-first, and the full e2e suite on a real dev server. One gap: issuance rate limit absent (Phase 1 + Phase 2 requirement, dropped at Phase 3) | **FAIL** | 2026-09-25 |
| 6 — Shipped vs intent | analyst | In progress | — | 2026-09-25 |

**Handoff:** to **api-developer** (Phase 4, Batch B) — the owner of `src/lib/statistics-grants.ts`, `src/app/(statistics-submit)/actions.ts` and the `reports/actions.ts` additions.

Owed:
1. **FAIL-1 (required):** an org-keyed `checkRateLimit` in `issueStatisticsGrantAction` (`reports/actions.ts:275`), on the `(password-reset)/actions.ts:51` precedent, with a test pinning the key and the blocked-response copy. Confirm in writing whether the limit is per issuing org, per issuing user, or both — Phase 2 said "per issuing org".
2. **Advisory 2 (cheap, same file):** restore `aboutOrgId` and `reportYear` to `STATISTICS_GRANT_REVOKED`'s metadata, per Phase 3's Audit Events block.
3. **Advisory 1 (your call, record the decision either way):** redact the Drizzle error object at `statistics-grants.ts:652` — log `code` and a fixed prefix rather than `err` — or state in the work-log that the hash-in-logs residual is accepted and precedented, so the security review does not re-raise it.

Not yours, and not a reason to hold the loop-back — for the **orchestrator**: the three pre-existing e2e failures (FAIL-2) and Advisories 3–6.

## Notes for Phase 6 (carry forward)

- **Release note: yes.** Member-visible, and a new public URL. Suggested framing: *a presbytery clerk can email a congregation with no account a one-time link to file its annual statistical report*.
- **What's-new advisory: yes, but not yet.** The flag ships **off**; the surface is presbytery-clerk-facing plus an emailed link. Publish a `whats_new_entries` row when the flag is first turned on for a real presbytery, not at merge. Worth saying out loud at Phase 6 so it isn't lost with the flag.
- **TODO candidates:** the three Phase 3 deferrals already drafted (congregation filing-history page; bounce visibility for issued-grant emails; `presby_withdraw_publication()` UI), plus, from this pass: the e2e chain-row residue (Advisory 3), the stale `post-login-routing` assertions and the `public-sites` bundle fixture (FAIL-2), `rate-limit.test.ts` under DB env (Advisory 5), and a `proxy.test.ts` case for the two new public paths (Advisory 6).
- **Integration facts.** The branch sits at `6f9f481`, **two commits behind `main`** (`9356755`) — **rebase before integration** to pick up the round-three `0043–0047` changes. Every change on this branch is an uncommitted working-tree change; there is no commit yet. The Rule 16 shared-file discipline held with **two declared exceptions**, both in `scripts/test-rls.sql` §35 (mid-file, not the appended block): the F55 arming-site pin, rewritten to assert "exactly one function arms it, and it is the chain writer" — which I verified live and which is strictly stronger; and B-M2's `search_path` exact-match widened to accept the `pg_temp` spelling. Both are correct and both carry inline `drizzle/0049` comments, but the integrating merge must expect them in §35, not §40, and must re-run `test-rls.sql` on the merged `development` branch. Also unedited on this branch and owed at integration: `docs/decisions.md` (DECISION-147), `docs/TODO.md`, `docs/STATE.md`, `docs/reviews/log.md`, release notes, `docs/product/functionality-map.md`, `docs/schema-design-2.md` §6's corrected sketch and the F80 resolution, `CLAUDE.md`'s un-brandable-group list, `.claude/agents/architect.md`'s route-group rules, and a `src/lib/dev-docs.ts` `INVARIANTS` entry for the credential mechanism marked `trigger`.



### Orchestrator notes (2026-09-25)

- **FAIL-2 is not this pipeline's:** `post-login-routing.spec.ts` tests 4 and 7 are the two reds `docs/TODO.md` already records as remaining by operator decision (`org_portal.home_v2` ON on the shared branch this one forked from — the flag-ON portal renders no `<h1>`); `public-sites.spec.ts:334` is the branch-fixture staging gap already tracked from the e2e-red pipeline. Both stay tracked; neither gates this pipeline.
- FAIL-1 and Advisories 1–2 → api-developer; Advisories 3 and 6 → ux-developer; Advisories 4–5 → TODO at integration.

---


## Re-verification after the second passes (2026-09-25, qa) — recorded verbatim by the orchestrator

Narrow re-check of the two second passes on the same worktree and branch. Flag found **OFF** as I left it, flipped **ON** only where a live check needed it, restored **OFF**. Read-only: I wrote nothing to the repo (`git status --short` unchanged at 30 entries, all the implementers').

## FAIL-1 — issuance rate limit: **CLOSED**

`reports/actions.ts:298` calls `checkRateLimit` **before** `issueStatisticsGrant`, keyed `stats_grant_issue:${identity.organizationId}`, `{ max: 30, windowSeconds: 3600 }`.

**Driven live — and the first attempt is the interesting part.** 32 consecutive issuances through the real UI as the `org-multi` presbytery fixture at distinct report years: **all 32 succeeded, nothing blocked.** That is not a defect in the feature — this worktree's `.env.local` sets `RATE_LIMIT_DISABLED=true` (which the e2e `globalSetup` *requires*), and `src/lib/rate-limit.ts:190` short-circuits to `{ allowed: true }` before the store is ever consulted. I restarted the dev server with `RATE_LIMIT_DISABLED=false` and re-ran at a fresh year range:

```
FIRST BLOCKED ON ATTEMPT #: 31
BLOCKED COPY: "Too many grants issued recently. Try again in 60 minutes."
```

Blocked on #31 against `max: 30`, with the exact copy from the source. Unit-level and live-level both, and I am naming which was which because the live one only exists if you notice the disable switch.

`rate_limit.blocked` audit row, read off the live table:

```
resource_type | rate_limit
resource_id   | stats_grant_issue:e2e00000-0000-0000-0000-000000000001
actor_user_id | 994c96c8-aa95-4303-9bcd-8f9014b79dfb
metadata      | {"actor": "e2e00000-...-0001", "reason": "statistics_grant_issue", "retryAfterSeconds": 3576}
```

**Judging the org-only key: sound, and the live row makes the case better than the code comment does.** The comment's argument is that a per-user key layered *alongside* the per-org one would only widen the budget for a multi-admin presbytery — correct, and the right call for the threat FAIL-1 named. What the comment doesn't say, and what the audit row shows, is that org-only keying costs nothing in forensics: `resource_id` carries the org-scoped budget key while `actor_user_id` still records *which* admin tripped it. Per-user attribution without per-user budget widening. Phase 2's "per issuing org" is met exactly. (A per-user key ANDed *inside* the org budget would add defence against one rogue admin among several, but per-org already bounds the email amplification, which is the harm. Not owed.)

`reports/actions.test.ts` — **7/7**, and non-vacuous: it asserts the literal key `stats_grant_issue:<ORG_ID>`, separately asserts `expect(key).not.toContain(USER_ID)`, pins both blocked-response strings (plural and singular-minute), asserts `issueStatisticsGrant`/`recordAudit` are never reached when blocked, and asserts revocation carries no limit. Removing the limiter call fails at least three of the seven.

*One note for Phase 6, not a gate:* 30/hour is generous for most presbyteries but not for all of them. A presbytery with 50–100 member congregations opening a new report year in one sitting will hit the wall partway through the bulk pass. The copy is friendly and it resumes in an hour, so this is a tunable, not a bug — worth knowing before the flag is turned on for a large presbytery.

## Advisory 2 — revoke audit metadata: **CLOSED**

Drove a real revoke through the UI (shadcn `AlertDialog`, buttons `["Cancel", "Yes, revoke"]`, "Revoked" badge appears). Live row:

```
metadata | {"grantId": "4d33a030-…", "aboutOrgId": "e2e00000-…-0004",
            "reportYear": 2069, "organizationId": "e2e00000-…-0001"}
```

Exactly Phase 3's Audit Events block. Verified on the row, not on the test.

## Advisory 1 — token hash in logs: **CLOSED**

Both `console.error` sites in `submitStatisticsGrant()` now pass `{ code: … ?? "unknown" }` and nothing else — the unexpected-error catch (`statistics-grants.ts:679`) and the audit-facts-lookup catch (`:634`), the latter extended voluntarily. Neither logs `err` nor `pgErrorInfo()`'s joined `.message` chain, which was the trap: that chain is built *from* the leaking Drizzle string, so it was never a safe substitute. The comments say so.

`statistics-grants-error-redaction.test.ts` — **2/2**. **I judged it non-vacuous by reading, and did not perform a local revert** — editing a repo file is outside this role's remit, and the reading is unambiguous rather than subtle. The chain: `FakeDrizzleQueryError.message` embeds a real 64-char sha256 hex; `serializeLoggedArgsForScan()` walks `.message`/`.cause` for any `Error` argument, so a reverted `console.error(…, err)` *would* surface it; both `not.toContain(TOKEN_HASH)` and `not.toMatch(/[0-9a-f]{64}/i)` then fail, and test 2's `toHaveBeenCalledWith(…, { code: "55000" })` fails independently.

Worth crediting explicitly: the implementer found that an earlier draft using `JSON.stringify` was a **false negative** — `Error.prototype.message` is non-enumerable, so `JSON.stringify(new Error(…))` is `{}` and the test would have passed against the buggy code. That is exactly the vacuity trap this phase exists to catch, and they caught it on themselves and wrote down how.

## Advisory 3 — e2e chain-row leak: **CLOSED**

`E2E_BASE_URL=http://localhost:3300 npx playwright test e2e/statistics-submit.spec.ts` against a real dev server, twice:

| | result | `e2e-gamma` returns / pubs / proj | grants | flag | freeze triggers |
|---|---|---|---|---|---|
| pre-run | — | 0 / 0 / 0 | — | `false` | — |
| run 1 | **7 passed** | **0 / 0 / 0** | 0 | `false` | all three `tgenabled='O'` |
| run 2 | **7 passed** | **0 / 0 / 0** | 0 | `false` | all three `tgenabled='O'` |

The five residual chain rows I reported in the first pass are also gone — the new `DO $cleanup$` teardown swept them. The single-`DO`-block reasoning (the `neon()` HTTP driver gives each tagged-template call its own implicit transaction, so one statement is the only available atom) is correct and matches `seed-orgs.ts`'s own precedent; the three unconditional re-enables afterwards are a reasonable belt.

## Advisory 6 — proxy exact-path cases: **CLOSED**

`src/proxy.test.ts` — **18/18** (13 pre-existing + 5 new). The negatives are the ones that matter and they are both present: `/file-statistics/anything-else` falls through to `edgeAuth()` and 307s to `/signin` with the deep link preserved, and `/file-statistics X`-style character-prefix matches do not admit. That is the exact-path semantics the `Set` provides and the `/site/*` `startsWith` bypass deliberately does not.

## Suites (re-run this pass)

| Check | Result |
|---|---|
| `npm run typecheck` | clean, exit 0 |
| `npm run check` | 5/5 tripwires pass |
| `npm test` | **3308 passed / 814 skipped / 0 failed** (+14 over the first pass: 7 + 2 + 5) |
| Three changed/new spec files | **27/27** (7 + 2 + 18) |
| `scripts/test-rls.sql` as `presby_app` | **exit 0, 456 passes, 0 FAIL** |
| DB-backed serial, 7 files | **185/185** |
| `e2e/statistics-submit.spec.ts` on 3300 | **7/7, twice** |

## Still open — not re-litigated, unchanged from the first pass

- **FAIL-2 (orchestrator, not this implementer):** the three pre-existing e2e failures — `e2e/post-login-routing.spec.ts:134` and `:195` (stale assertions against a portal home that renders no `<h1>` at all since `7e4f21a`) and `e2e/public-sites.spec.ts:334` (missing staged bundle on this Neon branch), with 5 `.serial` cascade skips behind the last. All three are byte-identical to `main` and outside this diff. I did not re-run the full suite this pass (scoped to the spec), so this stands as reported. **It is a precondition for merge, not for this pipeline's verdict.**
- **Advisory 4:** `normalizeRscNoise()` in the e2e spec is wider than its own comment (it blanks the whole flight payload). My independent narrower diff reached the same conclusion, so the spec's result holds.
- **Advisory 5:** `src/lib/rate-limit.test.ts` fails 3 tests when the whole lib suite is run *with* `DATABASE_URL`. Green under plain `npm test`.

## New advisory from this pass

**`RATE_LIMIT_DISABLED=true` in `.env.local` means no rate limit in this repo can be exercised live under the standard dev/e2e configuration** — and the e2e `globalSetup` *refuses to run without it*. So every limiter in the tree (sign-in, password reset, TOTP, feedback, contact form, and now grant issuance and submission) is guarded only by unit tests in routine practice; the live behaviour is only reachable by deliberately overriding the variable, as I did here. That is a testing-posture gap wider than this feature and worth a `docs/testing.md` line plus a TODO — it is how a limiter with a wrong key or an off-by-one window would ship green.

## Verdict

**PASS.**

The one gap that drove the FAIL is closed, and closed properly: the requirement traced back to Phase 1 and Phase 2 is now in the code, the key is the one Phase 2 named, the window is defensible, the behaviour is pinned by a non-vacuous unit test **and** proven live at attempt #31, and the blocked audit row has the right shape. The two advisories handled alongside it are closed on live rows rather than on assertions, and both of Batch C's are closed with the mechanism I asked for rather than the documentation escape hatch I offered as an alternative. No new defects surfaced. The branch is exactly as I found it: flag `false`, three seeded grant fixtures, zero chain residue, all thirteen relevant triggers `tgenabled='O'`, `test-rls.sql` at 456, working tree untouched.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | **Complete (re-verified after the Batch B and Batch C second passes)** — FAIL-1 closed and proven live (blocked on attempt #31, correct `rate_limit.blocked` row); Advisories 1, 2, 3, 6 closed and verified on live rows / live catalog / two clean e2e runs; typecheck, `check`, `npm test` 3308, `test-rls.sql` 456, DB-backed 185, spec 7/7 twice | **PASS** | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Ready to start | — | — |

**Handoff:** to **analyst** (Phase 6). Carry forward, from the first-pass section, the Notes for Phase 6 (release note yes; what's-new advisory deferred until the flag is first switched on for a real presbytery; the TODO candidates; the integration facts — rebase onto `main` for the round-three `0043–0047` changes, and the two declared mid-file `test-rls.sql` §35 edits the merge must expect). Add from this pass: the 30/hour issuance ceiling as a tunable worth revisiting for large presbyteries, and the `RATE_LIMIT_DISABLED` testing-posture advisory. **FAIL-2 (the three pre-existing e2e failures) remains open and orchestrator-owned** — it does not block Phase 6, but it does block merge.



### Orchestrator note on FAIL-2 (2026-09-25)

The three pre-existing e2e reds are not a merge precondition for this pipeline: `post-login-routing.spec.ts:134/:195` are the two reds the operator decided to leave until `org_portal.home_v2` is reset or e2e moves to an isolated branch (`docs/TODO.md`, 2026-09-25), and `public-sites.spec.ts:334` is the already-tracked staged-bundle fixture gap. Both lines stay open in TODO; the `RATE_LIMIT_DISABLED` testing-posture advisory becomes a TODO line at integration.

---


# Phase 6 — Shipped vs Intent (analyst)

*Recorded verbatim by the orchestrator, 2026-09-25.*

*Read-only review of `/Users/cshenso/git/presby-platform/presby-wt-grants/docs/work-log/2026-09-25-submission-grants.md` (all six phases), the shipped diff (`git show --stat 23db336`, `git log -1`), the three 360px/desktop screenshots, and direct reads of `src/proxy.ts`, `src/lib/audit.ts`, `src/lib/statistics-grants.ts`, `src/app/(org)/o/[slug]/admin/reports/actions.ts`, `src/app/(org)/o/[slug]/admin/reports/statistics-table.tsx`, and `docs/architecture.md`. Nothing edited.*

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> A presbytery clerk can now email an unmanaged or invited congregation a one-time link that lets it file its annual statistical report with no account — the credential, the write path, and the enumeration-safety posture are the most thoroughly load-bearing-checked increment I've reviewed in this repo, one real Phase 2→3 gate (issuance rate limiting) was dropped and then caught and closed before shipping rather than after, and what remains is a handful of named, already-scoped follow-ups (a deferred read-only page, an email-bounce blind spot, a rate-limit ceiling worth revisiting, and a testing-posture gap wider than this feature) — none of which are reasons to hold the flag off any longer than planned.

## What's Working

- **The credential model does exactly what DECISION-147 says it does, and QA proved it under adversarial conditions rather than trusting the design doc.** Two genuinely racing `psql` connections against the same live token produced exactly one winner and one `ERROR: presby_submit_granted_return: grant not usable`; a spent-token reload renders the same generic notice with no form and no resubmit path.
- **Enumeration safety is the real thing, not an assertion.** Six causes (nonexistent, expired, revoked, spent, malformed, and — the case the e2e spec itself doesn't cover — a *live* token with the flag off) returned byte-identical markup after normalizing only the token and Next's HMR id, with a 4.1 ms timing spread smaller than each cause's own noise band. `/file-statistics?token=…` and nothing else appears in the URL on either page.
- **The empty state on the issuance section is genuinely helpful, not just present.** The desktop screenshot shows "No submission grants issued yet — Issue one below to let an unmanaged or invited congregation file its statistical report without an account," inside a dashed card directly above the form that does exactly that — this is the "suggest a next action" standard from the Working Voice section, not a bare "No grants."
- **The failure microcopy on the public page is human.** "This link is no longer active … It may have expired, already been used, or been revoked. Nothing was saved. If you still need to file, ask your presbytery for a new link." — confirmed in the 360px screenshot, matches Phase 1's own "nothing was saved, try the link again" requirement verbatim.
- **The presbytery-sees-arrival flow really was "already half-built" as Phase 1 predicted**, and QA confirmed the new write lands on it: `statistics-table.tsx:14` maps `published_by_congregation` → "Congregation reported," and e2e case 4 shows the badge appearing after a real submission through a real browser.
- **The 60-field mobile form is a real UX pass, not a Phase 5 discovery this time** — Phase 2 named it as a binding Phase 3 deliverable, and it shows: `inputMode="numeric"` on 60/60 fields, single column at x=33 with zero horizontal overflow, a sticky submit bar visible without scrolling, and — verified with a DB check, not just a UI assertion — an out-of-range value leaves the DB at zero new rows and the grant unspent.
- **The one real gate that slipped (issuance rate limiting) was caught by QA, not by a later incident, and closed with evidence rather than a checkbox.** The fix was proven live at attempt #31 against a real `RATE_LIMIT_DISABLED=false` server, with the correct audit row and per-org (not per-user) key — QA judged the org-only keying choice on its merits rather than accepting Phase 2's ruling as license to skip verification.

## Intent-vs-Shipped Diff

| # | Phase 1 said | Shipped | Verdict |
|---|---|---|---|
| 1 | Presbytery admin issues a grant (congregation + year + recipient name/email) | `issueStatisticsGrantAction` → `statistics.manage` gate → `resolveMemberCongregation` re-check → mint/hash token → insert → enqueue email; partial-unique violation mapped to friendly copy | Matches |
| 2 | Presbytery admin revokes a live grant | Shadcn `AlertDialog` (`["Cancel", "Yes, revoke"]`, no native dialog) → distinct pre-checks for not-found / already-submitted / already-revoked before the guarded UPDATE | Matches |
| 3 | Presbytery admin re-issues after revoke/expiry | Partial unique index is scoped to live grants only (`where revoked_at is null and submitted_at is null`); a revoked/spent grant does not block re-issue | Matches |
| 4 | Presbytery admin sees grant status (issued/expired/revoked/submitted) | `grants-table.tsx` status column, verified live via revoke and via the e2e submission run | Matches |
| 5 | Anonymous visitor opens link → views form → fills → attests name+office → submits exactly once | Token resolved server-side only (`presby_preview_granted_return()`), form driven by the frozen `field_spec` with `sasr-fields.ts` labels, attestation is a closed `<select>` (clerk of session / moderator / other-with-text), atomic claim `UPDATE … RETURNING` inside one DEFINER function | Matches |
| 6 | Presbytery sees the return arrive | "Congregation reported" badge fires off the same `congregation_statistics` projection the existing self-publish path produces, via the shared chain writer | Matches |
| 7 | Congregation views its own filing history | **Deferred**, as the orchestrator's working assumption 4 and Phase 3's explicit non-goal recorded — `presby_list_own_congregation_publications()` still has zero UI callers (confirmed: only reference in the tree is `publication.test.ts`) | Acceptable drift — named up front in Phase 1, re-confirmed at Phase 3, carried to Phase 6's follow-up list, not a silent gap |
| 8 | "Rate-limit issuance and submission" (Phase 1 header line) | Submission (public) limit shipped in Batch B; **issuance limit dropped at Phase 3, caught as QA FAIL-1, closed in the second pass** | Regression, then closed before ship — see (c) below |
| 9 | Audit story for grant-issued/revoked/submitted, no session on the third | All three `AUDIT_ACTIONS` keys exist, exercised end to end, `{userId: null, email}` override on the submission row exactly as `requestPasswordReset` uses it; a full `audit_events` scan for the string `token` or a 64-hex value returned 0 rows | Matches |
| 10 | Email bounce visibility for the issuing clerk | **Deferred**, named as a residual in Phase 1's Edge Cases and carried through every phase to the TODO candidates | Acceptable drift — never silently dropped |
| 11 | Mobile usability of a 60-field form | Verified in a real 360×800 Chromium, not inferred from `next build` | Matches, and matches CLAUDE.md's "Verify in a Browser" standard specifically |

### The five orchestrator working assumptions, as design inputs — status and any revisit needed

1. **Presbytery staff only issue grants (`statistics.manage`).** Shipped exactly this; no self-service issuance path for a congregation's own clerk exists. No revisit needed.
2. **Tech-lead rules the affiliation instant.** Done — claim-time re-verification against the affiliation history, never the grant's own stored `organization_id`. See (d) below for precision on what F80's fix actually changes.
3. **Restrict grants to `unmanaged`/`invited` congregations.** Shipped as a database trigger at issuance (`presby_check_grant_about_org_unmanaged`), not the UI picker — the right enforcement point per CLAUDE.md's own "the check that matters is at write time" reasoning. Architect's Phase 3 observation stands and is worth restating for whoever revisits this: because a concurrent self-file resolves through the *existing* supersession chain rather than a special case, this is a **relaxable policy choice**, not a structural dependency — if a presbytery later asks to grant a `managed` congregation a link anyway (e.g., a congregation whose portal login is broken), that's a one-trigger change, not a redesign. No revisit needed now.
4. **Filing-history page deferred.** Confirmed deferred at every phase, correctly not built in this pipeline, correctly on the TODO candidates list. No revisit needed — it just needs to actually land in `docs/TODO.md` at integration (see Follow-Ups).
5. **No push notification, badge only.** Confirmed shipped as stated; no notification code exists in the diff. No revisit needed.

None of the five assumptions need to be revisited before the flag is turned on. All five were treated as real design inputs, not rubber-stamped — assumption 3 in particular got an explicit "policy, not structural necessity" ruling from the architect that is worth keeping visible for the next person who touches this area.

## The eleven Phase 2 BINDING gates — each checked against QA's evidence, not against the design doc's own claim

| Gate (Phase 2) | Shipped / verified how |
|---|---|
| `(statistics-submit)` route group, no `layout.tsx`, structurally `(password-reset)` | Confirmed by QA: no `layout.tsx`/`loading.tsx` anywhere in the group; `<meta name="robots" content="noindex, nofollow">` present |
| Token in query string, exact paths in `src/proxy.ts`'s `PUBLIC_PATHS` (no prefix bypass) | `src/proxy.ts:19-20` — two exact `Set` entries, confirmed by direct read; `proxy.test.ts` (18/18, 5 new) proves `/file-statistics/anything-else` falls through to `edgeAuth()` and a character-prefix match does not admit |
| Server action at group root, `check:audit` walks it (but audit coverage is "by review," not the tripwire) | `src/app/(statistics-submit)/actions.ts` exists at group root; QA states explicitly "audit coverage here is by review, not by tripwire" and independently scanned `audit_events` for leaked hashes/tokens (0 rows) rather than trusting the tripwire |
| `returns.ts` extended, no `grants.ts`, no `src/lib/db/domain/index.ts` touch | Confirmed by the diff stat (`src/lib/db/domain/returns.ts` modified, no new domain file) |
| Public submission signature takes no `personId`/`organizationId` | `submitStatisticsGrant(rawToken, payload, attestedByName, attestedRole)` — confirmed by direct read; QA's Feature-Gate Audit table independently states "signature accepts no personId/organizationId" |
| `sasr-fields.ts` with a key-set parity test | Shipped, 100% stmts/funcs per QA's coverage table, one uncovered branch named (line 192) |
| Attestation: server + client zod bounds, closed select for role | Confirmed live in the 360px screenshot (a `<select>`, not free text) and in `statistics-submit-form.test.tsx` |
| No org context set by the anonymous caller (the confused-deputy gate) | QA verified live: two racing `presby_app` connections with **no org context** on the claim, exactly one winner |
| One extracted chain writer, one `publication_write_active` arming site | Verified against the live catalog, not the migration text: "exactly one function arms `presby.publication_write_active`" |
| Claim first (atomic `UPDATE … RETURNING`), write second | Verified under genuine concurrency (above) |
| F80 constraints (recipient resolved fresh from affiliation history at claim time; no stored id treated as standing; same instant re-verified) | Verified via `test-rls.sql` §36(f)(i)/(ii) and `grants.test.ts:410`; see (d) below for the precise scope of what changed |

All eleven hold on the live system, not merely in the source. I did not find a BINDING gate that shipped as documentation only.

## (c) FAIL-1 and the process lesson

QA's FAIL-1 was exactly what it looked like: Phase 2 ruled, in a `[BINDING]` sentence, "Issuance is separately limited per issuing org" — and Phase 3's API Contract, Implementation Order, and Edge Cases table named only the *public* `stats_submit:${ip}` limit. The issuance half wasn't declined in writing, wasn't marked out of scope, wasn't deferred to a TODO line — it simply stopped appearing between Phase 2 and Phase 3. Phase 4 then built exactly what Phase 3 specified, which is the correct behavior for an implementer and the reason this is a Phase 3 defect, not a Phase 4 one.

This is precisely the failure mode CLAUDE.md's own workflow rules exist to catch — "no silent skips," and the explicit instruction to every downstream phase not to "summarize away the architect's rulings." A `[BINDING]` gate is supposed to be non-negotiable at handoff; this one was dropped by omission rather than by a stated disagreement, and nothing in Phase 3's text flagged the drop. QA was right not to wave it through on the strength of everything else being excellent, and right to phrase the verdict as "narrow" rather than downgrading the rest of the pass.

The good news is the closure: the fix is now in the code with an explicit comment naming the Phase 5 finding by work-log path (`reports/actions.ts:284-296` cites `docs/work-log/2026-09-25-submission-grants.md` and "Phase 5 FAIL-1" directly), it was proven live rather than by unit test alone (blocked on attempt #31 against a real `RATE_LIMIT_DISABLED=false` server, correct `rate_limit.blocked` audit row), and QA independently judged the org-only (not per-user) keying choice on its forensic merits rather than accepting Phase 2's ruling uncritically. This is a retrospective item, not a reopen: **recommend the tech-lead retrospective note this as a concrete example of a `[BINDING]` gate silently dropped at handoff**, for the next pipeline's Phase 3 checklist discipline, alongside the existing `npm run stats:escape` tracking.

## (d) F80 — precisely

F80 is not "the late filer can now file." A return for a report year before the congregation joined the receiving council is **still refused**, deliberately — that's the correct behavior and it didn't change. What changed is *where* and *how* the refusal happens: before this fix, `presby_publish_sasr_snapshot()` would write the `statistical_returns` row and the `publications` row (two inserts, two committed artifacts in the transaction so far) and only then hit `congregation_statistics_about_org`'s trigger on the third insert, which raised a generic, unnamed rejection — a half-written chain that then aborts. After the fix, the same year-endpoint affiliation check runs **once**, in `presby_write_return_publication_chain()`, **before the first insert**, with a named message identifying it as `presby_write_return_publication_chain: … was not affiliated with … during … — a return for a year before this congregation joined this council cannot be published to it.` QA verified this precisely: a 1990 grant for a congregation the presbytery didn't hold in 1990 is refused with byte-identical messages from both callers (the grant path and the self-publish path), and a before/after row count on `statistical_returns` proves nothing was written. The population most exposed to this — an account-less late filer, exactly D16's target user — now gets a clean, early, named refusal instead of an aborted transaction with orphaned-looking partial state; that is the entire scope of the fix, correctly scoped and correctly verified.

## Edge Cases

- **Empty state:** pass — the issuance section's dashed-card empty state names the action to take, not just the absence of data (screenshot `03-issuance-section-desktop.png`).
- **Failure microcopy:** pass — generic, humane copy on the public page ("Nothing was saved... ask your presbytery for a new link"), friendly rate-limit copy ("Try again in 60 minutes"), and a distinct "check the highlighted fields" message once token liveness is proven (never the raw SQL error).
- **Permission gate:** pass — triple gate on issuance (`org_portal.reports` page flag AND `statistics.submission_grants` feature flag AND `statistics.manage` permission), verified by QA reading route/action bodies rather than inferring from green tests; the public path correctly carries no `FEATURES.*` gate by design, credentialed instead.
- **Audit event:** pass — all three keys fire, the no-session actor-override shape is exactly `requestPasswordReset`'s precedent, and a full-table scan for leaked tokens/hashes in `audit_events` came back empty. One earlier gap (revoke's audit metadata thinner than Phase 3 specified) was caught as QA Advisory 2 and closed — live row now shows `{grantId, aboutOrgId, reportYear, organizationId}` exactly per spec.
- **Mobile (360px):** pass — verified in a real Chromium at 360×800 with a DB-state check after a failed submit, not just a visual screenshot.

## Follow-Ups (SHIP WITH NOTES)

Everything below should land in `docs/TODO.md` at integration (Rule 10), most already drafted by earlier phases and simply not yet applied to the shared file per the Rule 16 discipline this branch operated under:

1. **Congregation "view own filing history" page** — `presby_list_own_congregation_publications()` has been callable since `drizzle/0038` with zero UI consumers, deferred a second time by this pipeline. *TODO line:* `Congregation "view own filing history" page — presby_list_own_congregation_publications() built since drizzle/0038, still no UI caller; deferred by submission-grants (D16 increment 6).`
2. **Bounce visibility for issued-grant emails** — the issuing clerk has no signal today if delivery to `issued_to_email` fails. *TODO line:* `Bounce visibility for statistics-grant emails — issuing clerk cannot see email_queue 'failed' status without going through (admin); named residual since Phase 1.`
3. **`presby_withdraw_publication()` UI** — still unbuilt, withdrawal is owner-only. *TODO line:* `presby_withdraw_publication() UI — unbuilt; carried forward from the lifecycle-affiliation-returns pipeline and confirmed out of scope again here.`
4. **30/hour issuance ceiling is a tunable, not a bug, but worth revisiting** — a presbytery with 50–100 member congregations doing a bulk pass at a new report year will hit the wall partway through and have to wait out the hour. *TODO line:* `Issuance rate limit (stats_grant_issue, 30/hour org-keyed) — fine for typical presbyteries, will bind for large ones doing a bulk pass; revisit ceiling or add a batched-issuance UX before turning the flag on for a presbytery with 50+ member congregations.`
5. **`RATE_LIMIT_DISABLED` testing posture** — QA's sharpest new finding: `.env.local` sets `RATE_LIMIT_DISABLED=true` and the e2e `globalSetup` *requires* it, so every limiter in the tree (sign-in, password reset, TOTP, feedback, contact form, and now both grant limits) is exercised live only when someone deliberately overrides the variable, as QA did here twice. This is a platform-wide testing gap this feature happened to surface, not something this feature caused. *TODO line:* `RATE_LIMIT_DISABLED=true in .env.local silently disables every rate limiter under standard dev/e2e config, and e2e globalSetup requires it on — no routine test run exercises live limiter behavior; add a docs/testing.md line and a periodic live-limiter check (candidate: fold into the release-slot test-coverage review).`
6. **The two pre-existing e2e reds (FAIL-2)** — not this pipeline's defect (byte-identical to `main`, the portal renders no `<h1>` at all since `7e4f21a`), but it is a merge precondition per the orchestrator's own note. Already tracked per the orchestrator note in this work-log; confirm the TODO lines exist rather than re-adding duplicates.
7. **Minor test-hygiene items already closed but worth a durable note:** `normalizeRscNoise()` in `e2e/statistics-submit.spec.ts` is wider than its own comment (blanks the whole flight payload rather than just dev-mode reference IDs) — QA's own narrower diff reached the same conclusion, so no functional risk, but the spec's stated scope should be corrected. `rate-limit.test.ts` fails under `DATABASE_URL` (pre-existing, unrelated) — worth a `docs/testing.md` line so "run the whole lib suite with `dotenv -e .env.local`" isn't attempted as a supported command.

None of these block the flag being off today. Items 1–3 were scoped out from the start and simply need their already-drafted lines applied to `docs/TODO.md`; items 4–5 are genuine new discoveries from this pass and are the ones that most need a durable home before this pipeline's context is lost.

## Additional Phase 6 items

**Release note (0.26.0 draft):** *"Presbytery clerks can now email an unmanaged or invited congregation a one-time link to file its annual statistical report — no account required."* This is a light improvement on the orchestrator's draft (adds "unmanaged or invited," which is the actual scope, so a reader doesn't wonder why their fully-onboarded congregation didn't get one) — bless with that one-word-category addition, or ship the orchestrator's original if brevity matters more; both are accurate.

**What's-new:** correctly deferred. The flag ships off; publish a `whats_new_entries` row when it's first turned on for a real presbytery, not at merge — stated explicitly in both Phase 5 passes and worth restating here so it isn't lost once this work-log stops being anyone's active context.

**Rule 14 (functionality map):** the existing bullet for "presby: presbytery oversight & statistics" (`docs/product/functionality-map.md:25`) already documents `presby_publish_sasr_snapshot()` and the chain it writes; it should gain one clause noting that `presby_write_return_publication_chain()` now backs *two* callers — the existing self-publish path and the new account-less grant path — and that the latter ships at `(statistics-submit)` behind `statistics.submission_grants`, seeded off. This is a real change to a documented surface (a second caller of a described mechanism), not a new bullet.

**Rule 15 (architecture.md, the credential as a third mechanism):** **recommend no, not yet.** `docs/architecture.md:96` currently states the two-mechanism split ("permissions answers *may*, flags answer *is this on*") at the level a first-time reader needs. DECISION-147's "third access mechanism" framing is accurate and important, but today it describes exactly one flow in the entire platform — a single-use token authorizing one write inside one database function — not yet a recurring architectural pattern the way permissions and flags are (permissions and flags gate dozens of surfaces each; the credential mechanism gates exactly one). Password-reset tokens are structurally the same shape and architecture.md never needed a sentence for them either. Rule 15's own bar is "most feature work does not touch it" and "stays useful by staying stable" — I'd revisit this recommendation the moment a *second* feature adopts the credential pattern (at which point it's a real recurring subsystem, not a single flow), but adding a sentence now for one flow risks the same creeping-update problem Rule 15 warns against. If the orchestrator disagrees, the cheapest correct edit would be one clause appended to the existing permissions/flags sentence at line 96, not a new subsection.

**Rule 12:** n/a — confirmed, this work did not originate from in-app member feedback (no `Source` block in the work-log header).

## DECISION-147 final text

**Bless Phase 3's version** (`docs/work-log/2026-09-25-submission-grants.md:1553-1592`), which explicitly supersedes Phase 2's draft. I compared both against what actually shipped and against QA's independent verification: Phase 3's text is the more precise of the two — it correctly states the recipient is "re-resolved fresh from the affiliation history at claim time... with the grant's stored value used only as a staleness check" (Phase 2's draft didn't yet have this resolved), names the F80 fix's actual mechanism (the collision check moved into the shared writer, not duplicated), and describes the claim as the two-step transition (`submitted_at` then `return_id`) that the shipped freeze trigger actually enforces (three sanctioned transitions, not the two the earlier draft implied). Every clause in Phase 3's text is independently confirmed by QA's live-catalog checks — the recipient resolution, the single arming site, the column-level `UPDATE (revoked_at)` grant, the two racing connections producing one winner. No amendment needed; adopt Phase 3's text verbatim into `docs/decisions.md` at integration.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete | **SHIP WITH NOTES** | 2026-09-25 |



### Orchestrator closure (2026-09-25)

Shipped as v0.26.0 (`feat(statistics):`), integrated after the security §B merge per Rule 16 (merge of `main` incl. 0048 + round three, `test-rls.sql` re-run on the merged tree and again on `development` after `0049` applied there). DECISION-147 recorded; `docs/schema-design-2.md` §6 corrected with the F80 resolution; TODO reconciled; `(statistics-submit)` added to CLAUDE.md's un-brandable list and the architect agent's route-group rules; functionality map and release notes updated. What's-new: deferred until the flag is first turned on for a real presbytery.
