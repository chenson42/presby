# Security review 2026-09-25 — two HIGH fixes (open-redirect bypass; tier-3 audit leak) — Work Log

> **Slug:** `2026-09-25-security-review-highs`
> **Surface:** (auth) — `src/lib/auth/safe-callback.ts` (`sanitizeCallbackUrl()`, used by `/launch?next=`, the TOTP-verify redirect and the credentials sign-in redirect); (org) server action — `src/lib/person-sensitive.ts` (`setPersonDisabilitiesAction`'s audit payload). No UI change.
> **Permission(s):** existing; no new key.
> **Flag(s):** not needed.
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant (CLAUDE.md). Phase 2 skipped unless the fix touches an invariant — it does not (documented here). **Auth-touching:** `src/lib/auth/` is in scope, so Phase 4's gate applies — a running-server e2e smoke covering the full login path including an MFA-enrolled user is required before Phase 5, and Phase 5 PASS requires that e2e ran (deferred = BLOCKED). Two `fix:` commits (one per bug), both `Caught-By: agent-review`, `Discovered-In: post-merge`, `Work-Log: 2026-09-25-security-review-highs`. Parallel-pipeline rules (Workflow Rule 16): this pipeline touches neither schema files nor `scripts/`; shared docs edited only by the orchestrator at integration.
> **Source:** `docs/reviews/2026-09-25-security.md` §A, findings H-new-1 and H-new-2 (api-developer, reproduced live).
> **Bugs:** (1) `sanitizeCallbackUrl()` (`src/lib/auth/safe-callback.ts:17-20`) rejects `//`-prefixed and absolute URLs but not a leading backslash; per the WHATWG URL spec `/\evil.example` resolves off-origin, so the open redirect closed 2026-07-11 (H1 of the 2026-05-17 review) has regressed. (2) `setPersonDisabilitiesAction` (`src/lib/person-sensitive.ts:695-702`) writes `categories: input.categories` — tier-3 medical data for a named person — into `audit_events`, rendered verbatim at `/admin/audit` to any `FEATURES.ADMIN_AUDIT` holder; its three sibling actions correctly write `{ organizationId }` only.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (bug-fix brief) | READY WITH NOTES | 2026-09-25 |
| 2 — Architectural review | architect | Skipped — bug-fix variant, no invariant touched: both fixes restore the documented behaviour of an existing guard and an existing tier rule | — | 2026-09-25 |
| 3 — Technical design | tech-lead | Complete (brief) | — | 2026-09-25 |
| 4 — Implementation | api-developer | Complete (loop-back re-verification done — Findings 1/2 closed) | — | 2026-09-25 |
| 5 — Verification | qa | Complete — FAIL then PASS on re-verification (sanitizer output postcondition; 36 unit cases; e2e Tests 5/6/7 green on a real server with the MFA-enrolled fixture; 4,700-payload output probe found no escape). Audit-payload half passed first time. Auth gate satisfied, not deferred | PASS | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-09-25 |

---

# Phase 1 — Functional Refinement (analyst)

*Bug-fix variant brief, recorded verbatim by the orchestrator, 2026-09-25.*

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

Both HIGHs are real and confirmed live against the current tree; the sanitizer fix as drafted in the review is necessary but not sufficient — a second WHATWG bypass class (tab/newline stripping producing `//`) survives the proposed patch and must be closed by the same change, and the audit-payload fix's scope boundary (`children.ts`'s `relationship` field) needs an explicit in/out decision before Phase 3.

## Bug 1 confirmed — `sanitizeCallbackUrl()` backslash bypass (H-new-1)

**Exact input, observed behaviour.** Against the unmodified `src/lib/auth/safe-callback.ts:17-20` (`raw.startsWith("/") && !raw.startsWith("//") ? raw : "/launch"`): input `"/\\evil.example"` satisfies `startsWith("/")` and fails `startsWith("//")`, so the function returns it unchanged. Verified with Node's WHATWG-compliant `URL` parser: `new URL("/\\evil.example", "https://good.example").href → "https://evil.example/"`. The current `src/lib/auth/safe-callback.test.ts` (11 tests, green) exercises no backslash payload. Live call sites feeding an unvalidated `redirect()`: `src/app/launch/page.tsx:59,93`, `src/app/(auth)/totp/actions.ts:32,79` (post-2FA-success — the most dangerous, since it fires right after the victim proves identity with a real TOTP code), `src/app/(auth)/signin/actions.ts:113`. Bug confirmed.

**Why the 2026-07-11 regression test didn't catch this.** H1 (2026-05-17) was about a missing guard entirely; the fix added two prefix checks and the test suite was written to those checks, not to the WHATWG spec they approximate. A prefix-matching guard and a spec-conformance guard are different objects.

## Bug 2 confirmed — `setPersonDisabilitiesAction` audit-payload leak (H-new-2)

`src/lib/person-sensitive.ts:694-701` writes `metadata: { organizationId, categories: input.categories }` — the caller-supplied disability-category set for a named person. The three siblings in the same file (`addPersonNote` `:429-436`, `setPersonMedical` `:610-615`, `setPersonDemographics`) write `{ organizationId }`-shaped payloads only, so this is the sole outlier. `/admin/audit/page.tsx:275,326-330` renders `row.metadata` verbatim via `JSON.stringify` inside a `<details>` disclosure gated only by `FEATURES.ADMIN_AUDIT` (`src/lib/permissions.ts:83-86`) — a platform-shell permission with no org scoping and no tier check: CLAUDE.md's tier rule crossed by a platform-axis permission. Bug confirmed. Companion instance: `src/lib/children.ts:509-513` writes `relationship: input.relationship` on `TENANT_PERSON_RELATIONSHIP_ADDED` (family structure, tier 1/2; same principle).

## Intended behaviour each fix must preserve

**Sanitizer — must keep working:** `/launch`; plain relative paths; relative paths with query string and/or fragment (`/o/alder-creek?tab=roll#row-3` — currently untested); legitimately percent-encoded path segments; absence → `/launch`.

**Sanitizer — must reject (→ `/launch`):** `//evil.example` and protocol-relative variants; absolute-scheme URLs incl. `javascript:`/`data:`; backslash forms `/\evil.example`, `\/evil.example`, `/\\evil.example`, `/\/\evil.example`, `https:/\evil.example`; **embedded tab/newline forms** `/\t\t/evil.example`, `/\n/evil.example` (the WHATWG parser strips ASCII tab/newline from the whole input before parsing, collapsing them to `//evil.example` — neither the current guard nor the review's draft `includes("\\")` catches this). Confirmed safe by direct repro and worth locking in as tests: `%2F%2Fevil.example`, `%5Cevil.example`, fullwidth solidus U+FF0F — none resolve off-origin.

**Audit payload:** `metadata: { organizationId }` matching the siblings; `resourceId` already names the person. A count or boolean is defensible; the categories or any tier-3 enum string are not. No existing consumer reads `categories` (the audit page renders generically).

## Scope gap to resolve before Phase 3

The work-log's Surface line names only `safe-callback.ts` and `person-sensitive.ts`; the review's punch-list bundles `children.ts:509-513`. Recommend including it — same one-line fix, same principle; otherwise a `docs/TODO.md` line per Rule 10.

## Regression tests each fix owes

1. `src/lib/auth/safe-callback.test.ts` — new `describe("backslash and control-character bypasses (H-new-1, 2026-09-25 regression)")`: leading backslash → `/launch`; double backslash; backslash-first without slash (assert stays `/launch`); embedded tab (`"/\t\t/evil.example"` — **must fail against the review's draft patch, not only the original**); embedded newline; relative path with query+fragment passes unchanged; encoded-slash and encoded-backslash forms pass unchanged (guards against an over-broad textual fix).
2. `src/lib/person-sensitive.test.ts` — inside the existing `describe.skipIf(!hasDb)`: `describe("audit metadata shape — no tier-3/tier-2 payload content (H-new-2 regression)")`, one `it()` per sensitive action asserting `mockRecordAudit.mock.calls[0][0].metadata` deep-equals `{ organizationId }` (exact key set, so a renamed re-addition is caught). Fails before the fix.
3. If `children.ts` is included: a matching `it()` asserting `TENANT_PERSON_RELATIONSHIP_ADDED`'s metadata is `{ organizationId, childPersonId }` with no `relationship` key.

## The auth-touching e2e gate

`e2e/totp-full-login.spec.ts` and `e2e/totp-callback-bypass.spec.ts` already cover the full login path with an MFA-enrolled user and a legitimate `callbackUrl` round-trip. **Neither sends a hostile payload.** This pipeline must add a case (in `totp-callback-bypass.spec.ts` or beside it): sign in as `mfa-enrolled`, supply `callbackUrl=/\evil.example` (and the tab form), complete a real TOTP code, assert at the network level (`page.on("request")`) that no request goes to a foreign origin and the final landing is `/launch`.

## Adversarial pass

The review's draft patch (`raw.includes("\\")`) is necessary but not sufficient: `new URL("/\t\t/evil.example", "https://good.example").origin → "https://evil.example"`. Ruled out by direct repro: `%2F%2F`, `%5C`, U+FF0F. **Recommendation, elevated from optional to required:** parse with `new URL(raw, "https://internal.invalid")` and compare `.origin` against the base's origin; reject on mismatch; then return the parsed pathname+search+hash (or the raw string only if it round-trips) — correct by construction against the parser production uses, and immune to the next WHATWG quirk. Pattern-matching has now been bypassed twice.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Anonymous visitor / any user mid-sign-in | clicks a crafted `?next=`/`?callbackUrl=` link, or completes a real TOTP code after being lured by one | attacker-initiated |
| Platform admin holding `FEATURES.ADMIN_AUDIT` | expands "View metadata" on a `tenant.person_disability.set` row at `/admin/audit` | on demand |

## Permissions & Flags

No new key; `FEATURES.ADMIN_AUDIT` continues to gate `/admin/audit`, only the payload it can read shrinks. No flag — both are `fix:` commits restoring documented invariant behaviour.

## Gaps the Request Didn't Address

- `children.ts` scope decision (above).
- The tab/newline bypass class is not named in the work-log's bug description or the review's draft patch — Phase 3 must name the parser-based fix.
- The hostile-payload e2e case is not yet an implementer deliverable — Phase 3 assigns it.

## Out of Scope (confirm with user)

L1–L4 (rate limiting, HTML escaping, UUID validation, timing-safe compare) — separate punch-list. F-1/F-2 (submission-grant design gaps; `transfer_certificates.claim_token` plaintext) — forward-looking.

## Open Questions

- Is `children.ts`'s `relationship` field in this pipeline or deferred? (Recommend in.)

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

Two independent, unrelated bugs, one pipeline, two `fix:` commits. **Bug 1** (root cause): `sanitizeCallbackUrl()` (`src/lib/auth/safe-callback.ts:17-20`) is a hand-rolled prefix check (`startsWith("/") && !startsWith("//")`) standing in for "is this a same-origin relative reference," which is actually a WHATWG URL-parsing question, not a string-prefix question. A prefix check can only ever enumerate the bypass shapes its author already thought of; the browser's parser has more normalization rules than any hand-written checklist — first the `//` rule (closed 2026-05-17), now the backslash-as-slash rule for special schemes (this review), and Phase 1 independently found a third the review's own draft patch (`raw.includes("\\")`) still misses: the parser strips embedded ASCII tab/newline from the whole input *before* applying any other rule, so `"/\t\t/evil.example"` collapses to `//evil.example` and resolves off-origin even though it contains no backslash at all. The fix shape is therefore not "add another string check" but "stop checking strings and ask the same parser the browser uses." **Bug 2** (root cause): `setPersonDisabilitiesAction`'s audit write treats `audit_events.metadata` as a general-purpose "what changed" log rather than as what CLAUDE.md's tier rule requires it to be — a change *notification* naming who and what row, never the sensitive value itself. Its three siblings in the same file already get this right; this one function copied the input payload into the metadata object, the same reflexive mistake `children.ts`'s two guardian-link writers made with `relationship`. Both are `fix:` commits restoring documented behavior — no new capability, no schema change, no permission/flag change.

## Permissions & Flags

No new key. `FEATURES.ADMIN_AUDIT` continues to gate `/admin/audit`, unchanged — only the payload it can render shrinks. No flag; both fixes restore existing invariant behavior unconditionally, not a staged rollout.

## API Contract

No new routes or server actions. One function signature changes shape (return contract, not parameters) and two existing server actions' internal audit-metadata object literals change:

- `sanitizeCallbackUrl(raw: string | undefined | null): string` — signature unchanged. Behavior change: input is now parsed with `new URL()` against a fixed base rather than string-matched; output is normalized `pathname + search + hash` (see §"Return raw vs. normalized" below), not the raw string.
- `setPersonDisabilities(...)` (`src/lib/person-sensitive.ts`) — no signature change. Its internal `recordAudit({ metadata })` call drops `categories`.
- `addGuardianLink(...)` / `updateGuardianLink(...)` (`src/lib/children.ts`) — no signature change. Their internal `recordAudit({ metadata })` calls drop `relationship`. (`removeGuardianLink`'s write, `:641`, is already `{ organizationId, childPersonId }` — no change, confirmed by grep, not in scope.)

## Data Model

No schema changes required.

## Component / Page Plan

No new pages or components. Files to modify:

- `src/lib/auth/safe-callback.ts` — rewrite `sanitizeCallbackUrl()` to parse rather than pattern-match.
- `src/lib/auth/safe-callback.test.ts` — extend with the bypass-class regressions and the parser-fix's own new edge cases (encoded chars, query/fragment survival, absolute-same-origin acceptance).
- `src/lib/person-sensitive.ts` — drop `categories` from `TENANT_PERSON_DISABILITY_SET`'s metadata (`:699`).
- `src/lib/person-sensitive.test.ts` — add the metadata-shape regression `describe` block covering all four audit writes in this file.
- `src/lib/children.ts` — drop `relationship` from `TENANT_PERSON_RELATIONSHIP_ADDED` (`:513`) and `TENANT_PERSON_RELATIONSHIP_UPDATED` (`:585`) metadata.
- `src/lib/children.test.ts` — add the matching metadata-shape assertion(s) for both writers (confirm exact test file name/harness shape when implementing — mirror `person-sensitive.test.ts`'s `describe.skipIf(!hasDb)` pattern if `children.ts` uses the same real-Postgres harness).
- `e2e/totp-callback-bypass.spec.ts` — add Test 5 (hostile-payload case, detailed below).
- `docs/release-notes/v0.24.md` — a Fix entry (draft below; the file is already modified in the working tree per git status, so this pipeline's entry lands alongside whatever is already staged there — coordinate at integration, don't overwrite).

No pages, no UI, no client components — every touch point is a pure function, a server-action's internal audit call, or a test file.

## Sanitizer fix — parser-based, not pattern-based

```typescript
const SAFE_BASE_ORIGIN = "https://internal.invalid";

export function sanitizeCallbackUrl(raw: string | undefined | null): string {
  if (typeof raw !== "string" || raw.length === 0) return "/launch";
  // Belt-and-braces ahead of the parser: reject embedded ASCII control
  // characters (0x00-0x1F, 0x7F) outright. The WHATWG parser already strips
  // tab/newline/CR before doing anything else — relying on that stripping
  // behavior to be caught by the .origin comparison below is correct and is
  // exactly what the tab-payload test below proves — but an explicit reject
  // here means a *future* parser quirk in a character class we haven't
  // enumerated fails closed instead of depending on parser behavior we'd
  // have to re-verify by hand every time. Cheap and it costs nothing that a
  // legitimate `next=` value would ever trip.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(raw)) return "/launch";

  let parsed: URL;
  try {
    parsed = new URL(raw, SAFE_BASE_ORIGIN);
  } catch {
    return "/launch";
  }

  const sameOriginAsFixedBase = parsed.origin === SAFE_BASE_ORIGIN;
  const sameOriginAsRealApp =
    APP_ORIGIN !== null && parsed.origin === APP_ORIGIN;
  if (!sameOriginAsFixedBase && !sameOriginAsRealApp) return "/launch";

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
```

Where `APP_ORIGIN` is `new URL(process.env.NEXT_PUBLIC_APP_URL).origin` computed once at module scope inside a `try` (falls back to `null` — see the absolute-URL edge case below), so a relative `raw` resolves against the fixed, unroutable base (an attacker-controlled `raw` can never *become* that base's origin, closing the class this review found twice) while a legitimate absolute same-origin URL — which NextAuth itself can hand this function, see Edge Cases — is still accepted by comparing against the app's real origin, never the fixed one.

**Return normalized, not raw, when it round-trips.** Recommend always returning `parsed.pathname + parsed.search + parsed.hash`, never the original `raw` string, even when they're textually identical. Reasoning: the entire point of routing `raw` through `URL` is that the parser is the thing we trust; returning the pre-parse string re-introduces exactly the "what does a browser do with this text" question the parser was supposed to answer once and for all. A normalized return also collapses `//`, encoded-slash, and backslash variants to their real same-origin path *when they are legitimately same-origin* (none of the hostile inputs below are, so this never fires for them) rather than silently accepting textual noise. The cost is that a handful of legitimate inputs get lightly rewritten (e.g. Unicode percent-decoding in `search`); Edge Cases below confirms none of those rewrites change any real destination `computeDestination()` cares about, since that function only inspects `pathname` via `orgSlugFromPath()`/`pathnameOf()`, both of which already split on the same characters `URL` normalizes.

**Not imported by `src/proxy.ts`.** Confirmed by direct read (above): `proxy.ts` imports only `@/lib/auth/config` and `@/lib/permissions`; it builds its own `callbackUrl` query params with `URLSearchParams` directly and never calls `sanitizeCallbackUrl()`. This function stays a plain Node/browser-runtime module (it already uses no Next.js API) — the Edge-safety constraint doesn't currently bind it, but nothing in this fix adds a dependency that would newly break Edge compatibility if a future pipeline did import it there (`URL` is available on the Edge runtime).

**Hostile inputs — must resolve to `/launch`** (Phase 1's list, verbatim, plus the review's original four):
`//evil.example`, `https://evil.example/steal`, `evil.example/steal` (no leading slash), `javascript:alert(1)`, `data:text/html,<script>alert(1)</script>`, `/\evil.example`, `\/evil.example`, `/\\evil.example`, `/\/\evil.example`, `https:/\evil.example`, `/\t\t/evil.example` (embedded tab — literal `\t` character, not the two-character escape), `/\n/evil.example` (embedded newline), plus a literal-CR variant `/\r/evil.example` for completeness since the parser strips CR alongside tab/LF.

**Legitimate inputs — must survive** (normalized form, per above): `/foo` → `/foo`; `/admin/users` → `/admin/users`; `/o/alder-creek` → `/o/alder-creek`; `/o/alder-creek?tab=roll#row-3` → unchanged (currently untested, Phase 1 flagged this gap); `null`/`undefined`/`""` → `/launch`; percent-encoded path segments (`/o/alder%2Dcreek`) → parser-normalized equivalent, confirmed to still split correctly under `orgSlugFromPath()`; `%2F%2Fevil.example`, `%5Cevil.example`, fullwidth solidus U+FF0F (`／／evil.example`) — Phase 1 confirmed by direct repro these do **not** resolve off-origin, so they pass through as literal (encoded, inert) path text, not rejected.

**The proof-of-work the implementer owes** (Phase 1's adversarial framing, made a required step, not optional diligence): before writing the real fix, write the review's own draft patch (`raw.includes("\\")` layered onto the existing prefix check) as a throwaway local variant, run the new embedded-tab test (`"/\t\t/evil.example"`) against it, and confirm it **fails** (returns the hostile string unchanged, because it contains no backslash) — then delete the draft and implement the `URL`-based fix above, which passes the same test because the parser itself strips and normalizes the tab before the origin comparison runs. This is not a formality: it is the concrete demonstration that "add one more string check" is the wrong fix shape, referenced back to Phase 1's adversarial pass and the review's own admission that pattern-matching has been bypassed twice now.

## Audit payload fix

**`setPersonDisabilitiesAction` / `setPersonDisabilities`** (`src/lib/person-sensitive.ts:699`): metadata becomes `{ organizationId, categoryCount: input.categories.length }`. Recommend **count over nothing**: `resourceId` already names the person and the audit action name (`tenant.person_disability.set`) already says *what kind* of change happened, so the count adds only magnitude ("this write touched 3 categories" vs. "this write cleared everything," `categoryCount: 0`) without ever naming a category — a platform admin reading `/admin/audit` can distinguish a substantive edit from a clear-all, which is useful for spotting anomalous bulk changes, and cannot reconstruct or narrow down which tier-3 attribute was involved. This is a judgment call inside the "no sensitive content" rule, not a relaxation of it — flag if the user wants `{ organizationId }` only to match the three siblings exactly; either is defensible, but count is worth the one extra field.

**`children.ts` is IN scope** (Phase 1's open question, resolved: in). Same principle, same fix shape, one line each:
- `addGuardianLink` (`:513`): metadata becomes `{ organizationId, childPersonId }` — drop `relationship`.
- `updateGuardianLink` (`:585`): same change, same shape.
- `removeGuardianLink` (`:641`) already writes `{ organizationId, childPersonId }` — confirmed unchanged, not touched.

Rationale for ruling it in rather than deferring to `docs/TODO.md`: it is the exact same one-line class of fix, in a file already open for this pipeline's regression-test work, and leaving a known-identical instance of a just-fixed bug pattern unfixed in the same review cycle is the kind of gap a fourth security review would re-flag as "found again, still open" — cheaper to close now than to re-discover.

**Exact-key-set regression tests** (Phase 1 named these; the exact key set per action is the *already-correct* shape for that action, not a single literal object copied four times — `addPersonNote`'s shape legitimately differs from its siblings):

In `src/lib/person-sensitive.test.ts`, inside `describe.skipIf(!hasDb)`, new `describe("audit metadata shape — no tier-2/tier-3 payload content (H-new-2 regression)")`:
- `addPersonNote` → `mockRecordAudit.mock.calls[0][0].metadata` deep-equals `{ organizationId, personId, visibility: input.visibility }` (unchanged shape — this one was already correct; asserting it locks in that a future edit doesn't add note *content*).
- `setPersonDemographics` → deep-equals `{ organizationId }`.
- `setPersonMedical` → deep-equals `{ organizationId }`.
- `setPersonDisabilities` → deep-equals `{ organizationId, categoryCount: number }` — assert the key set is exactly `["organizationId", "categoryCount"]` and that `categoryCount` matches the number of categories in the test's input, so a silent re-addition of `categories` (the leak) or drift in the count is caught. Fails before the fix (currently includes `categories`).

In `children.ts`'s own test file (confirm exact filename during implementation — likely `src/lib/children.test.ts`), matching `it()`s for `addGuardianLink` and `updateGuardianLink`: `mockRecordAudit.mock.calls[0][0].metadata` deep-equals `{ organizationId, childPersonId }`, no `relationship` key. Fails before the fix (currently includes `relationship`).

## The auth-touching e2e gate

CLAUDE.md's Phase 4 gate applies (Surface line names `src/lib/auth/`). `e2e/totp-full-login.spec.ts` and `e2e/totp-callback-bypass.spec.ts`'s existing four tests already exercise the full login path with the MFA-enrolled fixture (`mfa-enrolled` → `admin-2fa-enrolled@presby.invalid`, seeded by the Playwright suite's own `globalSetup`/`seed-users.ts`, per `docs/testing.md` — not `scripts/seed-dev.sql`). None sends a hostile payload. Add **Test 5** to `e2e/totp-callback-bypass.spec.ts`, alongside the existing four, following the same `signInWithCallback()` helper and network-observation pattern already in that file:

```
test("5 — a hostile callbackUrl (backslash and tab forms) never leaves the origin, even after a real TOTP code completes sign-in (H-new-1 regression)")
```

- Sign in via `signInWithCallback(page, "mfa-enrolled", "/\\evil.example")` (the backslash form) — assert landing on `/totp` with `callbackUrl` normalized to `/launch` in the query string (per the sanitizer running at `/signin/page.tsx` before the form ever renders — confirm this against the actual normalized-return behavior once implemented: the sanitizer rejects the hostile value outright, so `callbackUrl` should read `/launch`, not a mangled evil-adjacent string).
- Register a `page.on("request", ...)` listener from the start of the test (same pattern as Tests 1/2/4) and assert, after completing a real TOTP code (`generateSync({ secret: E2E_TOTP_TEST_SECRET })`, same as the other specs), that no captured request URL's origin differs from the test's own `baseURL` origin — i.e. the browser never issues a request to `evil.example` or any other foreign host.
- Assert final landing is `/admin` (mfa-enrolled's computed destination once verified, matching Test 1's control shape) reached via `/launch`, never a bare navigation to a foreign origin.
- Repeat the same assertions for the tab form (`"/\t\t/evil.example"`) as a second `test()` in the same file, since Phase 1 named this as the class the review's own draft patch misses — a single test proving only the backslash form is fixed would leave the more dangerous bypass unverified.

**How QA runs it:** `npm run test:e2e` against `playwright.config.ts`'s existing `webServer` (dev server on `localhost`, auto-started unless one is already running locally, per `docs/testing.md`/CLAUDE.md's `test:e2e` note — "needs the dev server running"). Fixtures come from the suite's own `globalSetup` (`e2e/support/global-setup.ts` → `seed-users.ts`, `seed-orgs.ts`), not `scripts/seed-dev.sql`; no new fixture or env var is needed — `mfa-enrolled` already exists. This is a running-server smoke, matching CLAUDE.md's Phase 4 gate verbatim; a `BLOCKED` verdict (not `PASS`) is required at Phase 5 if this test is skipped or deferred.

## Implementation Order

1. `src/lib/auth/safe-callback.ts` — implement the parser-based fix. Confirm `APP_ORIGIN` resolution doesn't throw when `NEXT_PUBLIC_APP_URL` is unset in a test/dev environment (wrap in `try`, fall back to `null`, treat "no real app origin known" as "only the fixed-base same-origin check applies").
2. `src/lib/auth/safe-callback.test.ts` — write the failing draft-patch proof (throwaway, per the adversarial-pass requirement above, not committed), then the full hostile/legitimate test matrix against the real fix, green.
3. Commit 1 (`fix:`), sanitizer only. Typecheck + unit tests green.
4. `src/lib/person-sensitive.ts` + `src/lib/children.ts` — drop the sensitive fields from the four call sites named above.
5. `src/lib/person-sensitive.test.ts` + `children.ts`'s test file — the exact-key-set regression tests, confirmed failing against the pre-fix code, then green.
6. `e2e/totp-callback-bypass.spec.ts` — add Test 5 (both forms). Run `npm run test:e2e` against a real dev server; confirm the four existing specs still pass (no regression) and Test 5 passes.
7. Commit 2 (`fix:`), audit-payload fix (both files — `person-sensitive.ts` and `children.ts` — in one commit, since they're one root cause per Phase 1/the review, not two).
8. Release notes entry (below) added to `docs/release-notes/v0.24.md` in the same housekeeping pass — coordinate with whatever else is mid-flight in that file per `git status`.

Both commits: `Caught-By: agent-review`, `Discovered-In: post-merge` (the review found this in the already-shipped, live tree — not caught during this feature's own Phase 1-6, hence `post-merge` rather than a `Phase-N` value), `Work-Log: 2026-09-25-security-review-highs`.

## Release Notes Draft (v0.24, Fix entry)

> **Fixed a regressed open-redirect in the post-sign-in redirect handling, and a data-sensitivity leak in the audit log.** A backslash- or tab-prefixed callback URL could redirect a signed-in user to an external site immediately after completing two-factor authentication; the callback-URL check now parses the URL the same way a browser does, instead of matching against a fixed set of known-bad prefixes. Separately, recording a member's disability categories or a child's guardian relationship no longer writes the sensitive detail itself into the platform audit log — only that a change occurred.
>
> - Fixed: `sanitizeCallbackUrl()` rejected `//`-style and absolute redirect targets but missed backslash and embedded-whitespace forms a browser's URL parser treats as absolute; it now parses every candidate and compares its resolved origin against the app's own.
> - Fixed: audit-log entries for disability-category and guardian-relationship changes no longer include the changed values, matching the existing pattern for every other sensitive-field audit write in the app.

## Edge Cases & Risks

- **Encoded characters the parser normalizes.** `URL` percent-decodes and re-encodes per the WHATWG spec; the only consumer of the sanitized output, `computeDestination()`, reads it via `orgSlugFromPath()`/`pathnameOf()` (both split on `/`, `?`, `#` — plain string operations on the *already-normalized* result). No real destination changes: a legitimate `/o/alder-creek` or `/admin/users` round-trips byte-identical, since none of those paths contain characters `URL` would rewrite. Risk is theoretical (a slug containing a character requiring percent-encoding), and organization slugs are DNS-label-constrained (CLAUDE.md's `(org)` contract) — no valid slug can trigger a rewrite.
- **NextAuth-produced absolute same-origin URLs.** Checked all three callers: `launch/page.tsx` passes `raw` from `searchParams` (always relative or attacker-controlled, never NextAuth-internal); `totp/actions.ts` passes `formData.get("callbackUrl")`, sourced from the query string the same way; `signin/actions.ts`'s `input.callbackUrl` is `sanitizeCallbackUrl(sp.callbackUrl)`'s own *output*, already sanitized once at the page level before being handed to the action — so today, no caller feeds this function a NextAuth-internal absolute URL (e.g., `signIn()`'s own `redirectTo` resolution). **Still add the `APP_ORIGIN` comparison** (in the fix above) rather than only the fixed-base check: it costs one extra `URL` construction at module load, it is the behavior CLAUDE.md's doc comment on this file implies ("safe same-origin" should mean the *real* origin, not just "syntactically relative"), and it protects the next caller who *does* hand this function an absolute URL from being surprised that a legitimate same-origin absolute link is silently downgraded to `/launch`. Add both directions as tests: `https://presbyportal.org/admin` (matching `NEXT_PUBLIC_APP_URL`) → accepted, normalized to `/admin`; `https://evil.example/admin` → rejected, `/launch`.
- **`raw` is not a string.** Current guard is `if (!raw) return "/launch"`, which also catches `0`/`false`/`NaN` were they ever passed (they aren't — the type is `string | undefined | null`) but not, say, an array from a malformed `searchParams` read. Recommend tightening to `typeof raw !== "string" || raw.length === 0` (shown above) — belt-and-braces against a caller that ever changes shape, no behavior change for any of the three current call sites since `firstValue()`/`formData.get()`/`sp.callbackUrl` all already coerce to `string | null`.
- **e2e blast radius.** `e2e/totp-callback-bypass.spec.ts` Tests 1-4 and `e2e/totp-full-login.spec.ts` assert on the *current* prefix-based sanitizer's pass-through behavior for legitimate paths (`/admin`, `/o/e2e-alpha`, `/launch`) — none of them exercise a path shape the parser-based fix treats differently, so no existing assertion should flip. The one interaction worth double-checking at implementation time: Test 3's assertion that `callbackUrl` reads exactly `/launch` in the `/totp` query string after a `no-callbackUrl` signin — confirm the normalized-return change doesn't alter this (it shouldn't; `/launch` has no query/fragment to normalize). No other e2e spec (`role-boundaries.spec.ts`, `member-home.spec.ts`, `post-login-routing.spec.ts`, per `totp-full-login.spec.ts`'s own header comment) touches `sanitizeCallbackUrl()`'s output shape. No existing spec reads `/admin/audit`'s rendered metadata for disability or guardian-relationship rows (grep confirms no `e2e/*audit*` spec exists), so the audit-payload fix has no e2e blast radius — unit-test coverage is sufficient there, matching the review's own recommendation.
- **Risk, sanitizer:** none identified beyond the above — this is a strict narrowing of accepted inputs (fewer strings pass through unchanged than before), so the only failure mode is a false rejection of a legitimate path, covered by the "must survive" test list.
- **Risk, audit payload:** none — strictly removes data from a write path with no reader depending on the removed field (confirmed: `/admin/audit/page.tsx` renders `metadata` generically via `JSON.stringify`, no field-specific logic).

## Implementer

**api-developer.** Every touched file is a pure function, a server-action's internal logic, or a test file — no schema, no new UI, no component work. Matches the Scope table (route handlers / server actions / server logic).

---

# Phase 4 — Implementation

**Implementer:** api-developer. **Date:** 2026-09-25.

## Files Created

None.

## Files Modified

- `src/lib/auth/safe-callback.ts` — replaced the prefix-matching guard with a
  parser-based one: rejects non-strings and embedded ASCII control characters
  up front, then `new URL(raw, "https://internal.invalid")`, accepts only when
  the result's `.origin` equals the fixed base's origin (and `raw` is itself a
  rooted `/`-path, not `//`) **or** equals the real app origin
  (`process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"`, the same
  fallback convention every other server-rendered page in this codebase
  already uses — `account/actions.ts`, `(password-reset)/actions.ts`,
  `lib/email/send.ts`), and returns the normalized `pathname + search + hash`.
  Module still imports nothing beyond `URL`.
- `src/lib/auth/safe-callback.test.ts` — rewrote in full: the 11 original
  cases (unchanged expectations) plus a new `describe("backslash and
  control-character bypasses (H-new-1, 2026-09-25 regression)")` (11 cases:
  every backslash form, embedded tab/newline/CR, the three "confirmed safe"
  encoded/fullwidth-solidus forms proven to pass through unchanged) and a new
  `describe("absolute same-origin acceptance")` (2 cases). 27 tests total, all
  green.
- `src/lib/person-sensitive.ts` — `setPersonDisabilities`'s audit metadata:
  `{ organizationId, categories: input.categories }` →
  `{ organizationId, categoryCount: input.categories.length }`.
- `src/lib/person-sensitive.test.ts` — added
  `describe("audit metadata shape — no tier-2/tier-3 payload content
  (H-new-2 regression, 2026-09-25)")`, one exact-key-set `it()` per sensitive
  action in the file (addPersonNote, setPersonDemographics, setPersonMedical,
  setPersonDisabilities).
- `src/lib/children.ts` — `addGuardianLink` and `updateGuardianLink`'s audit
  metadata: `{ organizationId, childPersonId, relationship: input.relationship }`
  → `{ organizationId, childPersonId }` (both call sites; `removeGuardianLink`
  was already correct and untouched, confirmed by grep both before and after).
- `src/lib/children.test.ts` — added
  `describe("audit metadata shape — no family-structure content (H-new-2
  companion regression, 2026-09-25)")`, one `it()` exercising both writers
  against the same created/updated row and asserting the exact key set on
  each call.
- `e2e/totp-callback-bypass.spec.ts` — added Test 5 (backslash form) and Test
  6 (embedded-tab form), both per Phase 3's spec: sign in with a hostile
  `callbackUrl`, assert the `/totp` landing's `callbackUrl` query param reads
  `/launch` (proving the sanitizer rejects it at the page level, before the
  form ever renders), complete a real TOTP code from the `mfa-enrolled`
  fixture's secret, assert the final landing is `/admin` reached via
  `/launch`, and assert via a `page.on("request")` listener that no request
  captured across the whole flow had an origin other than the test's own.
  One divergence from the Phase 3 sketch: the design's `getByRole("heading",
  { name: /welcome/i })` landing assertion (copied from Tests 1/3/4 in this
  same file) was replaced with `getByRole("heading", { level: 1 })` — see
  Implementer Notes, this is a pre-existing, unrelated defect discovered
  while running the suite, not something introduced by this pipeline.

## Schema Changes

None.

## Audit Events

- `tenant.person_disability.set` (`AUDIT_ACTIONS.TENANT_PERSON_DISABILITY_SET`)
  — metadata shape changed from `{ organizationId, categories }` to
  `{ organizationId, categoryCount }`. Same action key, same trigger
  condition (`setPersonDisabilities` success), payload only.
- `tenant.person_relationship.added` / `tenant.person_relationship.updated`
  (`AUDIT_ACTIONS.TENANT_PERSON_RELATIONSHIP_ADDED` /
  `TENANT_PERSON_RELATIONSHIP_UPDATED`) — metadata shape changed from
  `{ organizationId, childPersonId, relationship }` to
  `{ organizationId, childPersonId }`. Same action keys, same trigger
  conditions, payload only. `TENANT_PERSON_RELATIONSHIP_REMOVED` unchanged
  (was already `{ organizationId, childPersonId }`).

No new `AUDIT_ACTIONS` keys; `npm run check:audit` passed unchanged (it
checks that mutations call `recordAudit` with a known action key, not payload
shape — exactly the gap H-new-2 exploited, per the review's own Checklist
row: "does not (and cannot) catch H-new-2's *content* leak, which is a payload-
shape judgment, not a missing-call judgment").

## Implementer Notes

**1. The draft-patch failing-first proof (required by Phase 3 before writing
the real fix).** Ran the review's own draft patch as a throwaway script
against the embedded-tab payload before writing any source change:

```
$ node scratch-proof.mjs
draftPatch(evilTab) = "/\t\t/evil.example"
Expected /launch, got: FAIL (bug confirmed - hostile string returned unchanged)
Browser-resolved origin of draftPatch's output: https://evil.example
```

Confirmed exactly what Phase 1/3 predicted: `raw.includes("\\")` layered onto
the existing prefix check does not catch `"/\t\t/evil.example"` — it contains
no backslash, so the draft patch returns it unchanged, and a browser resolves
it to `https://evil.example`. This is the concrete demonstration that the fix
shape had to change from "add one more string check" to "ask the URL parser."
The throwaway script was deleted, not committed.

**2. The `isRootedPath` addition — a divergence the Phase 3 pseudocode didn't
fully spell out, needed to reconcile two of its own requirements.** The
Phase 3 code sketch compares only `parsed.origin` against the fixed base and
the real app origin. Implementing that literally causes a schemeless,
slash-less candidate like `"evil.example/steal"` to parse as a same-origin
*path* against the fixed base (`"/evil.example/steal"`) and be **accepted** —
but Phase 3's own "must reject" list explicitly includes
`evil.example/steal (no leading slash)` (inherited from the original H1
review), while its "must survive" list explicitly requires the
percent-encoded/fullwidth-solidus forms to "pass through as literal (encoded,
inert) path text, not rejected." Both classes lack a leading `/`, so origin
comparison alone can't distinguish them — the fixed-base branch needed one
more condition: `raw.startsWith("/") && !raw.startsWith("//")` (a literal
rooted-path check on the *raw* string, not a re-introduction of the old
prefix guard, since the real security work — rejecting the backslash/control-
character bypasses — is still done entirely by the origin comparison, not by
this check). Verified against the full hostile/legitimate matrix by hand
(`node -e`) before writing the test file; the final 27-case suite is the
record of that verification. Net effect: `"evil.example/steal"` → `/launch`;
`"/%2F%2Fevil.example"` (i.e., a rooted path containing the encoded
forms) → passes through unchanged, per Phase 3's example list.

**3. Failing-first proof for the audit-payload tests, run against real
Postgres** (`dotenv -e .env.local -- vitest run`, per each test file's own
header comment):

- `person-sensitive.test.ts`: reverted `setPersonDisabilities`'s metadata line
  to the pre-fix shape, ran `-t "H-new-2"` →
  `setPersonDisabilities' metadata is exactly { organizationId, categoryCount }
  — no category values (the H-new-2 leak)` failed with `AssertionError:
  expected { …(2) } to deeply equal { …(2) } - categoryCount: 3 + categories:
  ["hearing","mobility","sight"]`. Restored the fix, full file re-run: 26/26
  green.
- `children.test.ts`: same procedure on `addGuardianLink`/`updateGuardianLink`
  → `AssertionError: expected { …(3) } to deeply equal { …(2) } +
  relationship: "guardian"`. Restored the fix, full file re-run: 24/24 green.

**4. A pre-existing, unrelated defect found while running the e2e suite —
not introduced by this pipeline, not fixed by this pipeline.** Running the
full suite (`npm run test:e2e`) surfaced 16 failures + 7 "did not run" tests
across specs this pipeline never touched
(`admin-login.spec.ts`, `branded-signin.spec.ts`, `color-scheme.spec.ts`,
`header-controls.spec.ts`, `member-home.spec.ts`, `post-login-routing.spec.ts`,
`public-sites.spec.ts`, `timezone-safe-dates.spec.ts`,
`totp-full-login.spec.ts`, and Tests 1/3/4 — not 5/6 — of
`totp-callback-bypass.spec.ts`). Root-caused by direct read, not assumed:
commit `7e4f21a` ("platform home merge, permission-filtered admin portal, and
marketing page redesign") replaced `/admin`'s bare `<h1>Welcome,
{name}.</h1>` with `GreetingBand` (`src/components/shared/greeting-band.tsx`),
whose own header comment says so explicitly: *"`/admin`'s previously bare
`<h1>Welcome, {name}.</h1>` adopts the same accent-stripe treatment..."* For
any fixture with a resolvable display name (every fixture used in these
specs), the heading now reads a time-of-day greeting (`"Good morning, E2E MFA
Enrolled Admin."`), never literally "Welcome" — so every
`getByRole("heading", { name: /welcome/i })` assertion against a named user's
`/admin` landing now fails, including in **`totp-full-login.spec.ts`**, the
file CLAUDE.md's Phase 4 gate names by name as the required MFA-enrolled
smoke. A second, distinct pre-existing failure was also found in this same
run: `post-login-routing.spec.ts` Test 1 ("a platform admin with no
congregations lands on /admin") now lands on `/home` instead, which reads as
a second regression from the same "platform home merge" commit (a
`/home`-vs-`/admin` destination-matrix change), not a copy-only issue. Neither
defect touches `sanitizeCallbackUrl()`, `person-sensitive.ts`, or
`children.ts`, and neither is in this pipeline's Surface line or file list —
fixing `src/app/(admin)/admin/page.tsx` or `src/app/launch/destination.ts`
would be scope creep into another agent's remit and risks colliding with the
parallel pipeline's in-flight work. **Flagging for the orchestrator to route
as its own bug-fix pipeline** (not filed to `docs/TODO.md` by this pipeline
per its explicit "do not edit `docs/TODO.md`" instruction) — recommend a
`Discovered-In: post-merge`, `Caught-By: agent-review` bug-fix work-log
against `src/components/shared/greeting-band.tsx`/`src/app/launch/
destination.ts` and the ~8 affected e2e specs.

Given the above, this pipeline's own Tests 5 and 6 were changed to assert
`getByRole("heading", { level: 1 })` on the `/admin` landing instead of
copying the now-broken `/welcome/i` pattern from Tests 1/3/4 in the same
file — the security property under test (no cross-origin request, correct
final path) does not depend on the heading's copy, and asserting a stale
string would make this pipeline's own new regression tests fragile against a
bug this pipeline didn't introduce and isn't fixing.

**5. Full e2e run results** (`npm run test:e2e`, real dev server, fresh
`globalSetup` fixtures, `mfa-enrolled` = `admin-2fa-enrolled@presby.invalid`):
**97 passed, 16 failed, 7 did not run** (of 120 total). Both of this
pipeline's new tests passed:
`totp-callback-bypass.spec.ts:152:7 › ... 5 — a hostile callbackUrl
(backslash form) ...` and `:195:7 › ... 6 — a hostile callbackUrl
(embedded-tab form...) ...`. All 16 failures and all 7 "did not run" (5
cascaded from a `public-sites.spec.ts` failure, 2 from a `branded-signin.spec.ts`
failure, both in the same `describe` block as an earlier failing test) trace
to the pre-existing defects in Note 4 above or to environment-dependent specs
unrelated to auth (`color-scheme.spec.ts` — headless dark-mode media query;
`header-controls.spec.ts` 360px touch-target sizing; `timezone-safe-dates.spec.ts`
— locale/timezone-dependent rendering). None of the 16+7 touch
`sanitizeCallbackUrl`, `person-sensitive.ts`, or `children.ts`. Ran once (no
retry needed — this was not a globalSetup/DB collision with the parallel
pipeline; root cause was identified by direct code read, not by re-running).

**6. Unit suite.** `npm test` (plain `vitest run`, the canonical command,
no `.env.local`, DB-backed suites skip via their own `hasDb` guard): **3222
passed, 755 skipped, 0 failed** (246 files passed, 29 skipped). Separately,
`dotenv -e .env.local -- vitest run` (exercises the DB-backed suites for
real, against the shared `development` Neon branch) showed 3 unrelated
failures in `src/lib/rate-limit.test.ts` — traced to `.env.local` carrying
`RATE_LIMIT_DISABLED=true` as a standing local-dev convenience (confirmed:
the same file passes 15/15 when run without `dotenv`), not a rate-limit
regression. A second dotenv run additionally saw one flake in
`groups.test.ts`/`officers.test.ts`/`tenant-branding.test.ts`/an `(org)`
staff-actions test — all DB-backed suites outside this pipeline's file list,
consistent with the shared `development` branch also carrying the parallel
pipeline's concurrent schema/trigger work (per this review's own note: "the
D10/D19/D20/D21 lifecycle/affiliation/publication schema unit shipped
2026-09-24... a second hardening round is mid-flight"). This pipeline's own
two DB-backed files (`person-sensitive.test.ts`, `children.test.ts`) were
run in isolation multiple times during implementation (see Note 3) and were
always green on their own. `npm run typecheck`: clean. `npx eslint` on every
touched file: clean (one warning — an unnecessary `eslint-disable-next-line
no-control-regex` comment, since this project's config doesn't enable that
rule — removed). `npm run check` (all five tripwires): all green,
`check:audit` unaffected as expected (see Audit Events above).

**7. No `docs/TODO.md`, release-notes, or `package.json` edits** — per this
pipeline's explicit scope note, those are the orchestrator's to reconcile at
integration alongside the parallel pipeline's in-flight changes to the same
files.

## Handoff

**Next: qa (Phase 5).** Both bugs are fixed, both have failing-then-passing
regression coverage (unit + e2e), and every verification command in the
implementer gate ran clean. The one item QA needs to make an explicit call
on: whether the auth-touching e2e gate is satisfied given that the
CLAUDE.md-named smoke file (`totp-full-login.spec.ts`) currently fails for a
**pre-existing, unrelated** reason (Implementer Note 4) rather than being
deferred or skipped — this pipeline's own Tests 5/6 in
`totp-callback-bypass.spec.ts` exercise the same full credentials → `/totp`
→ real-TOTP-code → landing path QA is looking for, and both pass. Recommend
QA treats Note 4 as a separate, pre-existing bug to name in its verdict
rather than a gap in this pipeline's own coverage, but that judgment belongs
to QA, not to the implementer who found it.

---

## Loop-back after Phase 5 (api-developer, 2026-09-25)

QA's Phase 5 FAIL (below) named two blocking findings, both confined to
`src/lib/auth/safe-callback.ts` and its regression coverage — the
audit-payload half (`person-sensitive.ts`, `children.ts`) passed and was not
touched in this loop-back, per the orchestrator's explicit scope note.

**Root cause, confirmed independently before touching source.** The Phase 4
fix asked the URL parser whether the *input* parsed same-origin, and returned
whatever the parser produced without re-checking *that returned string*.
WHATWG dot-segment normalization (`remove_dot_segments`) consumes a `.` or
`..` path segment as part of the same parse that computes `.origin` — so
`"/.//evil.example"` parses with `origin === SAFE_BASE_ORIGIN` (the origin
check the Phase 4 code performed) while the resulting `pathname` is exactly
`"//evil.example"` — a protocol-relative string a caller's `redirect()`
re-resolves off-origin the instant a browser (or Next's own redirect
machinery) sees it. The fix that closed H-new-1 asked "does the parser trust
this parse?" when the real question, for the *return value*, is "does the
parser trust the string I am about to hand back?" — a postcondition on the
output, not a fact about the input.

**Failing-first proof, run before writing the fix** (per the same
adversarial-proof discipline Phase 3/QA required for the original fix):
reconstructed the Phase-4-committed `sanitizeCallbackUrl()` verbatim in a
throwaway script (`old-sanitize.mjs`, deleted, not committed) and ran it
against QA's six repro payloads:

```
"/.//evil.example" -> got: "//evil.example" expected /launch -> FAIL (bug confirmed)
"/..//evil.example" -> got: "//evil.example" expected /launch -> FAIL (bug confirmed)
"/a/..//evil.example" -> got: "//evil.example" expected /launch -> FAIL (bug confirmed)
"/%2e//evil.example" -> got: "//evil.example" expected /launch -> FAIL (bug confirmed)
"/.//evil.example?x=1#f" -> got: "//evil.example?x=1#f" expected /launch -> FAIL (bug confirmed)
"http://localhost:3000/.//evil.example" -> got: "//evil.example" expected /launch -> FAIL (bug confirmed)
```

All six reproduce Finding 1 exactly, including the absolute-origin branch
(the sixth case) QA also named. Separately confirmed with a second script
that a browser resolving `"//evil.example"` against a real document origin
(`https://good.example/current-page`, standing in for whatever page issued
the redirect) lands on `https://evil.example` — the mechanism QA's live 307
repro demonstrated.

### Files Modified (this loop-back)

- `src/lib/auth/safe-callback.ts` — added a POSTCONDITION check after
  building `result` (the normalized `pathname + search + hash`): re-parses
  `result` against `SAFE_BASE_ORIGIN` and requires `.origin ===
  SAFE_BASE_ORIGIN` **and** `!result.startsWith("//")` **and**
  `!result.startsWith("/\\")`; any failure returns `/launch` instead of
  `result`. The round-trip re-parse is the real check (it independently
  catches the dot-segment class because `new URL("//evil.example",
  SAFE_BASE_ORIGIN)` resolves as protocol-relative, taking the base's scheme
  and the payload's own authority, landing on a foreign origin); the two
  explicit `startsWith` guards are belt-and-braces on top, per QA's exact
  wording, for a hypothetical future case where the round-trip and the
  string shape disagree. No change to the existing pre-normalization checks
  (`isRootedPath`, the two origin comparisons, the control-character guard) —
  QA's Finding 1 is about the *output*, not those input-side checks, and QA's
  "Confirmed correct" section already cleared `isRootedPath`. Added a header
  comment (both at the top-of-file SECURITY note and inline at the
  postcondition block) stating the principle QA named: a sanitizer's
  postcondition is asserted on its output, not its input.
- `src/lib/auth/safe-callback.test.ts` — added a ninth `describe` block,
  `"dot-segment normalization producing a protocol-relative OUTPUT (H-new-1
  Phase 5 loop-back regression, 2026-09-25)"`: eight cases naming every
  payload from QA's Finding 1 repro list (`/.//evil.example`,
  `/..//evil.example`, `/././/evil.example`, `/a/..//evil.example`,
  `/%2e//evil.example`, `/%2E%2E//evil.example`, the query+fragment variant,
  and the absolute-origin-branch variant), each asserted `→ "/launch"`; plus
  Finding 2's named invariant test — iterates the full hostile matrix
  (21 payloads: every prior bypass class plus all eight new ones) and
  asserts the return value never starts with `//` or `/\`. 9 new cases,
  36 total in the file (27 → 36).
- `e2e/totp-callback-bypass.spec.ts` — added Test 7: signs in as
  `mfa-enrolled` with `callbackUrl=/.//evil.example`, asserts the `/totp`
  landing's `callbackUrl` query param reads `/launch` (the sanitizer rejects
  it at `/signin/page.tsx`, before the form renders — per QA's own framing,
  this is the payload that *survived* `/signin` before this loop-back's fix,
  which is exactly why the case is needed end-to-end and not just at the
  unit level), completes a real TOTP code from the fixture's secret, asserts
  final landing is `/admin` reached via `/launch`, and asserts via a
  `page.on("request")` listener that no request captured across the whole
  flow had an origin other than the test's own. Not touched: Tests 1–6
  (unchanged).

### No other files touched

Per the loop-back's scope: `drizzle/`, `scripts/`, `src/lib/db/domain/`,
`src/app/globals.css`, `src/lib/brand/`, `person-sensitive.ts`,
`children.ts`, and their test files were not read or edited in this pass.

### Implementer Notes (loop-back)

**Verification commands, all run after the fix:**

- `npx vitest run src/lib/auth/safe-callback.test.ts` → **36 passed** (27
  Phase-4 cases + 9 new).
- `npm run typecheck` → clean.
- `npx eslint src/lib/auth/safe-callback.ts src/lib/auth/safe-callback.test.ts
  e2e/totp-callback-bypass.spec.ts` → clean, zero warnings.
- `npm test` (canonical `vitest run`, no `.env.local`) → **3235 passed, 760
  skipped, 0 failed** (246 files passed, 29 skipped) — the 13-test net
  increase over Phase 4's 3222 reflects this loop-back's 9 new unit cases
  plus unrelated concurrent changes from the parallel pipeline already
  in the working tree per `git status` at session start; no test in this
  pipeline's own files failed or was removed.
- `npm run check` (all five tripwires) → all green, `check:audit` unaffected
  (no `AUDIT_ACTIONS` or `recordAudit` call touched by this loop-back).
- e2e, real dev server: initial full-file run reused a stale, already-dead
  `next-server` process (left over from an earlier session, listening on
  port 3001 per `lsof`) and failed all seven tests with a connection error on
  `page.goto`; confirmed by direct process/port inspection, not assumed.
  Started a fresh dev server explicitly (`PORT=3001 npm run dev`, confirmed
  serving `200` on `/` before proceeding), then ran
  `E2E_BASE_URL=http://localhost:3001 npx playwright test
  e2e/totp-callback-bypass.spec.ts --reporter=list` twice for stability:
  **Tests 2, 5, 6, 7 passed both runs; Tests 1, 3, and 4 failed both runs**
  on the identical pre-existing `getByRole("heading", { name: /welcome/i })`
  assertion QA's own Finding 3 and Phase 4's Note 4 already attribute to
  commit `7e4f21a` (`GreetingBand` replacing the literal "Welcome" heading) —
  not this loop-back's concern and not touched. Server stopped cleanly after
  the run (confirmed via `lsof` — no listener remained on 3001).
  Port 3000 was free throughout this session (opposite of QA's environment
  note, which found 3000 occupied and 3001 free) — used 3001 anyway, per
  this loop-back's instruction, to stay consistent with QA's own run.

**Result: Findings 1 and 2 closed.** Finding 1's live repro shape
(`GET /launch?next=...` → `307` to a `//`-leading `location`) is now
unreachable — every payload in QA's list is rejected by the postcondition
before it becomes a return value — and Finding 2's named coverage exists and
is green. Finding 3 (pre-existing greeting-copy / destination-matrix defect)
remains untouched, as instructed; it is the orchestrator's to route as its
own bug-fix pipeline per QA's own handoff note.

### Handoff (loop-back)

**Next: qa (Phase 5 re-verification).** Scope for re-verification: Findings
1 and 2 only (`src/lib/auth/safe-callback.ts`,
`src/lib/auth/safe-callback.test.ts`, `e2e/totp-callback-bypass.spec.ts`
Test 7). The audit-payload half was already PASS-worthy per QA's own Phase 5
write-up ("the audit-payload half (H-new-2 + `children.ts`) would pass on
its own") and was not touched here. No commits made.

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-25 (first pass — FAIL; loop-back to Phase 4 follows).*

**Date:** 2026-09-25
**Verified by:** qa

## Type Check

`npm run typecheck`: **PASS**. `npm run check` (all five tripwires): **PASS**. `npx eslint` on all seven touched files: **PASS**, zero warnings.

## Unit Tests

`npm test` (canonical, no `.env.local`): Total 3977 | Passed 3222 | Skipped 755 | Failed **0** | 12.0s. DB-backed `--no-file-parallelism` on `person-sensitive.test.ts` + `children.test.ts`: **50 passed**, real Postgres, `recordAudit` mocked only as the assertion target.

### Failing-before proof (performed by me)

Overwrote each source file with `git show HEAD:<file>`, ran, restored byte-exact (md5 + `git diff --stat`).

| Regression test | Pre-fix | Post-fix |
|---|---|---|
| `src/lib/auth/safe-callback.test.ts` (whole file) | **9 of 27 fail** — every backslash form, embedded tab/LF/CR, fullwidth solidus, absolute-same-origin, non-string | 27/27 |
| `src/lib/person-sensitive.test.ts:870` | **FAIL** — `− categoryCount: 3 + categories: [...]` | pass |
| `src/lib/children.test.ts:541` | **FAIL** — `+ "relationship": "guardian"` | pass |

### Draft-patch proof, reproduced independently

The review's draft (`!raw.includes("\\")`) catches the backslash payload and **misses** the embedded-tab payload (`out="/\t\t/evil.example"`, browser-origin `https://evil.example`). Implementer Note 1 confirmed.

## End-to-End Tests

Real dev server (`PORT=3001`, `E2E_BASE_URL=http://localhost:3001`), fresh `globalSetup`, `mfa-enrolled` fixture present.

> **Environment note:** port 3000 was occupied by a `next-server` from `~/git/westervillelions`; Playwright's `reuseExistingServer` would have run the suite against the wrong app. Started after Phase 4's run, so it did not corrupt those results. Check `lsof -nP -iTCP:3000` or pass `E2E_BASE_URL` before re-running.

| Spec | Result |
|---|---|
| `totp-callback-bypass.spec.ts:152` — Test 5, backslash form | **PASS** |
| `totp-callback-bypass.spec.ts:195` — Test 6, embedded-tab form | **PASS** |
| `totp-callback-bypass.spec.ts:82` — Test 2 | PASS |
| `totp-callback-bypass.spec.ts:39/107/133` — Tests 1/3/4 | FAIL, pre-existing |
| `totp-full-login.spec.ts:23` | FAIL, pre-existing |

All four failures are the identical `getByRole('heading', { name: /welcome/i })` assertion after `waitForURL(/\/admin$/)` already succeeded — the login path completed; only the greeting copy differs. **Pre-existing attribution verified two ways:** `git show 7e4f21a` replaces the `<h1>Welcome…` with `<GreetingBand>` (`greeting-band.tsx:50-52` never renders "Welcome" for a named user) and changes `destination.ts`'s chooser branch `/orgs` → `/home` (DECISION-124), which is the second distinct failure (`post-login-routing.spec.ts:53`, `admin-login.spec.ts:7`, `member-home.spec.ts:29`); and a clean counterfactual with all seven pipeline files reverted to HEAD → **9 failed / 20 passed**, the same 8 specs.

**Ruling on the auth gate:** satisfied. Tests 5 and 6 prove the full path — credentials → `/totp` → a real TOTP code → landing — for the MFA-enrolled fixture on a real server with a network-level origin assertion. Not a deferred PASS.

## Regression Tests Added (verified)

`safe-callback.test.ts:84-135` (backslash, tab/LF/CR, encoded pass-throughs), `:20,30,68,149,155` (legit shapes, non-string, absolute origins); `person-sensitive.test.ts:817,842,856,870`; `children.test.ts:541`; `e2e/totp-callback-bypass.spec.ts:152,195`.

## Coverage on Critical Modules

`permissions.ts` 100% · `two-factor.ts` 91.3% / 100% branch · `flags.ts` 100% · `safe-callback.ts` 88.9% stmts / 100% branch (uncovered: the two `catch` fallbacks).

## Feature-Gate Audit

**No protected routes touched.** Diff is confined to the three lib modules, their tests, and one e2e spec; no `route.ts`, no `"use server"` file, no authorization predicate changed (filtered diff of the two lib modules to non-comment, non-`metadata:` lines returns zero). Schema/RLS audit: not applicable.

## Findings

### FINDING 1 (blocking) — the sanitizer fix introduces a *new* protocol-relative open redirect via WHATWG dot-segment normalization

`src/lib/auth/safe-callback.ts:107` returns `` `${parsed.pathname}${parsed.search}${parsed.hash}` ``. WHATWG path normalization removes a `.`/`..` segment and leaves an empty one behind, so `/.//evil.example` normalizes to a pathname of exactly `//evil.example`. The origin comparison passes (the parse *is* same-origin against the fixed base), but the returned string is a fresh, unvalidated relative reference that the caller's `redirect()` re-resolves — and a `//`-leading string is protocol-relative. `isRootedPath` inspects `raw`, not the output.

**Reproduced live** with an authenticated session: `GET /launch?next=%2F.%2F%2Fevil.example` → `307`, `location: //evil.example` → `https://evil.example/`. Same for `/..//evil.example`, `/././/evil.example`, `/a/..//evil.example`, `/%2e//evil.example`, `/%2E%2E//evil.example`, query/fragment variants, and via the absolute-origin branch. **Absent at HEAD** (the old code returned `raw`, which the browser resolved against the current origin with the host intact). Introduced by this change: closes the backslash and tab classes and re-opens the protocol-relative class H1 closed.

Suggested shape: assert the round-trip `new URL(result, SAFE_BASE_ORIGIN).origin === SAFE_BASE_ORIGIN` on the *returned* value (preferable to a `startsWith("//")` check — it validates the thing actually returned).

### FINDING 2 (blocking) — no test covers a path that *normalizes* to `//`

`safe-callback.test.ts:77-143` enumerates inputs that look dangerous; none exercises a benign-looking input whose **output** is dangerous. Tests 5/6 have the same shape (rejected at `/signin`, so the origin assertion never fires on a payload that survives). Required with the fix: `sanitizeCallbackUrl("/.//evil.example") === "/launch"` (plus `/..//evil.example` and a query/fragment variant) and an invariant case that the return value never starts with `//` for any input in the hostile matrix — watched failing first.

### FINDING 3 (non-blocking, own pipeline) — pre-existing e2e red from commit `7e4f21a`

Greeting copy (`greeting-band.tsx:50-52`) breaks `/welcome/i` assertions in `totp-full-login.spec.ts:61`, `totp-callback-bypass.spec.ts:79,130,147`; the destination change (`/orgs` → `/home`) breaks `post-login-routing.spec.ts:53`, `admin-login.spec.ts:7`, `member-home.spec.ts:29` — whether code or spec is wrong is a Phase 1 question (DECISION-124 says `/home`; CLAUDE.md's Post-Login Landing table still says `/admin`, so CLAUDE.md may itself be stale). Also observed, likely environment-dependent, unverified: `color-scheme.spec.ts:68`, `header-controls.spec.ts:131,426`, `timezone-safe-dates.spec.ts:36,71`, `public-sites.spec.ts:334`, `branded-signin.spec.ts:285`.

### Confirmed correct

The `isRootedPath` divergence is sound (strictly narrows; needed to reconcile Phase 3's two lists; does not address Finding 1). The audit-payload fix is complete and correct. No over-rejection across twelve legitimate inputs; host tricks all → `/launch`.

## Verdict

**FAIL.** `src/lib/auth/safe-callback.ts:107`; `src/lib/auth/safe-callback.test.ts:77-143` and `e2e/totp-callback-bypass.spec.ts:152,195` (coverage). Everything else passes; the audit-payload half (H-new-2 + `children.ts`) would pass on its own.

**Handoff:** api-developer (Phase 4) — close Finding 1 and add Finding 2 coverage, failing first. Copy tech-lead: the defect originates in Phase 3's "Return normalized, not raw" (work-log line 198), which validated the parse and not the return value — a sanitizer's postcondition must be asserted on its output. Orchestrator: Finding 3 needs its own bug-fix work-log.


## Re-verification after the Finding 1/2 loop-back (2026-09-25, qa) — recorded verbatim by the orchestrator

**Scope:** Findings 1 and 2 only (`src/lib/auth/safe-callback.ts`, its test, `e2e/totp-callback-bypass.spec.ts` Test 7). The audit-payload half was unchanged (`git diff --stat`: exactly three modified files, 462 insertions / 9 deletions) and its first-pass PASS stands.

### Type Check

`npm run typecheck` PASS · `npm run check` all five PASS · eslint on the three files PASS, zero warnings.

### Unit Tests

`safe-callback.test.ts` → **36 passed**. `npm test` → 246 files passed / 29 skipped; **3231 passed, 760 skipped, 0 failed** (the count moved under a parallel pipeline's working-tree changes; zero failures either way). Coverage `safe-callback.ts`: 87.5% stmts / 100% branch / 100% funcs; uncovered only the three defensive `catch` fallbacks.

**Failing-first, performed by me.** Phase 4's committed version was never committed, so I reconstructed it mechanically (current source with only the postcondition block `:125-156` removed) into the scratchpad — no repo file written or stashed. All nine new cases fail against it (`:163,167,171,175,179,183,187,191` each return `"//evil.example"`-shaped strings; `:202`'s invariant fails on 8 of 21 payloads) and pass against the shipped module: **9 of 9 fail before, 36/36 green after.**

### End-to-End Tests

Auth-touching → the stricter gate applies; **ran on a real dev server (`PORT=3002`) with the MFA-enrolled fixture, twice, identical results:** Test 7 (`:229`, dot-segment) **PASS**; Tests 5, 6, 2 PASS; Tests 1/3/4 FAIL on the pre-existing `/welcome/i` greeting assertion after a successful `waitForURL(/\/admin$/)` (commit `7e4f21a`; `docs/work-log/2026-09-25-e2e-red-on-main.md`). Server log for Test 7: `GET /signin?callbackUrl=%2F.%2F%2Fevil.example` → `GET /totp?callbackUrl=%2Flaunch` — rejected at `signin/page.tsx:47`, the hop that leaked before.

**Environment deviation, stated:** Next 16 enforces one dev server per directory (`lockfile.js`); after my 3002 server stopped, the parallel brand-parity pipeline held the lock on 3001, so the live repro below ran against 3001 — same tree, same code. The parallel run also overwrote `test-results/`; two pipelines sharing one repo contend for the dev lock and that directory.

### My Original Repro, Live

Authenticated as `mfa-enrolled` (password → real TOTP → `/admin`), redirects disabled, `Location` read: `/.//evil.example`, `/..//evil.example`, `/%2e//evil.example`, `/././/evil.example`, `/a/..//evil.example`, the query/fragment variant, the absolute-origin branch — **all `307 location: /admin`** (previously `//evil.example`). Earlier classes (backslash, tab, `//`) still refused. Legitimate shapes pass byte-identical (`/o/e2e-alpha?tab=roll#row-3` round-trips; absolute same-origin normalizes to the path). **Zero off-origin `Location` values.**

### Postcondition Completeness Review

Fuzz: 4,079 payloads → 955 accepted outputs, each re-resolved against four document bases → **0 escapes**; production-shaped `NEXT_PUBLIC_APP_URL=https://presbyportal.org` → 270 payloads, 45 accepted → **0 escapes**; control-character/header-splitting corpus (429) → every accepted output starts with a single `/`, no raw control chars. The five named shapes: `/\/evil.example`, leading `\`, mixed `/\` → refused; `/./https:/evil.example` → `/https:/evil.example` (path, safe); `/@evil.example` → path, safe (and `/.//@evil.example` → `/launch`). Each accepted odd shape driven through `totp/actions.ts`'s verbatim redirect with a real TOTP: all land on a same-origin 404, `foreign-requests=0`. **No output shape escapes the postcondition.**

### Feature-Gate Audit

**No protected routes touched** — three files, no route, no action, no predicate. Schema/RLS: not applicable.

### Findings

- **N1 (no action):** `safe-callback.ts:152`'s `!result.startsWith("/\\")` is unreachable (`URL.pathname` converts `\` to `/` or `%5C`); documented as belt-and-braces.
- **N2 (no action):** `/https://evil.example` → `/https:/evil.example` and `/@evil.example` are accepted, same-origin 404s — phishing-flavoured in a status bar, never leave the origin; narrowing risks the false-rejection class.
- **Finding 3 (other pipeline):** unchanged.

### Verdict

**PASS.** Findings 1 and 2 closed and independently verified; the auth gate satisfied on its own terms. **Handoff: analyst (Phase 6)**, carrying N1, N2, Finding 3, and the dev-lock/`test-results/` contention note.

---


# Phase 6 — Shipped vs Intent (analyst)

*Recorded verbatim by the orchestrator, 2026-09-25.*

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

Both HIGHs are closed by fixes that are correct by construction rather than by enumeration — the sanitizer now asserts a postcondition on its own output instead of trusting a fact about its input, and the audit payloads now carry magnitude, never content — and every regression this pipeline owes was watched failing before it was watched passing, including the third and fourth WHATWG bypass classes nobody had named at Phase 1 time.

## What's Working

- **The sanitizer is correct by construction, and the principle is recorded where the next editor will read it.** `src/lib/auth/safe-callback.ts:125-156` re-parses its own return value against the fixed base and rejects unless the round-trip is still same-origin and the string doesn't start with `//` or `/\`. The header comment (`:20-51`) narrates all four bypass generations — prefix check → backslash → embedded tab/newline → dot-segment-on-output — and states the lesson: *a sanitizer's postcondition must be asserted on its OUTPUT, not inferred from a check on its INPUT.*
- **QA's adversarial diligence matched the bar Phase 1 set:** 4,079 + 270 + 429-payload sweeps, each accepted output re-resolved against four document bases, zero escapes.
- **The audit-payload fix matches the Phase 1 recommendation exactly**, including the scope call: `categoryCount` (`person-sensitive.ts:707`) — magnitude without content; `children.ts:509-520` drops `relationship`, matching `removeGuardianLink`'s pre-existing shape.
- **Every named regression test exists and was watched failing before passing**, on both the implementer's side and QA's, twice.
- **The auth gate is satisfied on its own terms:** Tests 5/6/7 exercise credentials → `/totp` → real TOTP → landing for the MFA-enrolled fixture with a network-level no-foreign-origin assertion, on a live server, twice. The pre-existing greeting-copy red is a separately owned defect (`7e4f21a`, `docs/work-log/2026-09-25-e2e-red-on-main.md`), ruled in by QA's clean counterfactual.

## Intent-vs-Shipped Diff

- Hostile/legitimate shapes: **matches**, plus the dot-segment class Phase 1 could not have named — caught by QA one phase later than ideal, closed by the loop-back, re-verified independently: the process working as designed.
- `children.ts` scope: **matches** (ruled in, same commit).
- The hostile-payload e2e case: **matches, and grew** to Tests 5, 6, 7.
- `categoryCount` over bare `{ organizationId }`: **matches** — Phase 3's call, concurred.

## Edge Cases

Empty state: n/a. Failure microcopy: pass — the only failure outcome is the silent `/launch` fallback, always the stated intent. Permission gate: n/a in the RBAC sense; `FEATURES.ADMIN_AUDIT` unchanged, `check:audit` passes, no route or predicate touched. Audit event: pass — same keys, same triggers, payload shape only (Workflow Rule 7). Mobile: n/a.

## Drift Ruling

`isRootedPath` divergence: approved — it reconciles Phase 3's own two lists and strictly narrows. QA's N1 (unreachable `/\` guard): no action, documented belt-and-braces. QA's N2 (odd same-origin outputs accepted): no action — narrowing risks the false-rejection class; the property that matters holds.

## Follow-Ups

- L1–L4 and `transfer_certificates.claim_token` hashing — already in `docs/TODO.md`.
- The e2e admin-fixture invariant guard — being built in `docs/work-log/2026-09-25-e2e-red-on-main.md`; correctly not duplicated here.
- **New, not yet tracked: the Next dev-server lock and `test-results/` are shared, unpartitioned resources when two pipelines run e2e concurrently** — a TODO line at integration (added by the orchestrator).
- Release notes: a Fix entry is warranted (security fix on a public deployment); drafted below in user terms without an exploit recipe.

## Rule 12/13

Feedback row: n/a (source is the security review). What's-new: n/a (nothing member-visible).

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete | **SHIP IT** | 2026-09-25 |

### Orchestrator closure (2026-09-25)

Two `fix:` commits (audit payloads; sanitizer) with `Caught-By: agent-review`, `Discovered-In: post-merge`, `Work-Log: 2026-09-25-security-review-highs`. Release notes 0.24.2 (the round-two hardening, still in its last correction round, moves to 0.24.3). TODO reconciled: the dev-lock/`test-results/` contention line added. No functionality-map or architecture change.
