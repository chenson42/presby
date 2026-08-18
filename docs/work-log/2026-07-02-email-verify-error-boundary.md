# (email-verify) error boundary — Work Log

> **Slug:** `2026-07-02-email-verify-error-boundary`
> **Surface:** (email-verify) route group
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Full (small — brief phases)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete | READY FOR DESIGN | 2026-07-02 |
| 2 — Architectural review | architect | complete | Approved | 2026-07-02 |
| 3 — Technical design | tech-lead | complete | — | 2026-07-02 |
| 4 — Implementation | ux-developer | complete | — | 2026-07-02 |
| 5 — Verification | qa | complete | PASS | 2026-07-02 |
| 6 — Shipped vs intent | analyst | complete | SHIP IT | 2026-07-02 |

---

## Intent (2026-07-02)

isUniqueViolation Phase 1 note 4: the (email-verify) route group has no
error.tsx — non-23505 throws from the verify-email page produce a raw 500.
Add a segment error boundary consistent with ui-standards.md ("add when a
segment does data fetching"). Analyst: check whether OTHER route groups
also lack error.tsx and whether this pipeline should cover the set or just
(email-verify) (lean: just this one + a ui-standards note; a global
error.tsx audit is scope creep). Client component constraint: error.tsx
must be 'use client' per Next.js.

---

## Phase 1 — Functional Refinement — 2026-07-02

**Owner:** analyst
**Status:** complete

### Summary

The `(email-verify)` route group has no `error.tsx`. The `verify-email/[token]/page.tsx` already handles every anticipated failure case with `ErrorCard` components, but an unexpected throw (network hiccup, DB timeout, unhandled constraint violation) surfaces as a raw Next.js 500 with a stack trace visible in development and a white screen in production. A `'use client'` error boundary here gives the user a human message with a next step. Scope is this group only.

### What I did

#### Pass 1 — User Verbs

- **Anonymous visitor** (email-change verification link click): lands on `/account/verify-email/<token>` → sees either a success redirect or a known ErrorCard. If an unhandled throw fires, they currently see a 500.
- The verb is passive: the user arrives via email link; they don't type or click anything on the page itself.

#### Pass 2 — Flow Audit

**Flow 1 — Happy path (existing):** email link → page renders → token valid, not expired → DB batch update → redirect to `/account?emailChanged=1`.

**Flow 2 — Known error paths (existing):** invalid token → ErrorCard("invalid or already used"); expired token → ErrorCard("expired"); account not found → ErrorCard("Account not found"); unique constraint on new email → ErrorCard("already claimed").

**Flow 3 — Unhandled throw (the gap):** DB timeout / unhandled Drizzle error / module crash → currently: raw 500. After fix: `error.tsx` boundary renders, user sees a human message with a "Back to account settings" link.

- Failure outcome (error.tsx): The user sees a card-style message explaining something went wrong (not their fault), with a link to `/signin` (they may not be signed in — the proxy explicitly exempts this path).

#### Pass 3 — Permissions and Flags

No permission or flag involved. The `(email-verify)` route group is public by proxy design (line 27 of proxy.ts exempts `/account/verify-email/*`). The error boundary inherits the same public posture.

#### Pass 4 — Edge Cases

- **Unauthenticated visitor:** The error.tsx boundary must NOT redirect to `/account` (the user may not have a session). The "next step" link should be `/signin`, optionally with `?callbackUrl=/account` for after they sign in.
- **No layout in this route group:** The `(email-verify)` group intentionally has no layout (the page comment documents this). The error.tsx must be fully self-contained — its own centered card, no shared nav shell.
- **`error.tsx` must be `'use client'`:** Next.js App Router requires this. The component receives `error: Error` and `reset: () => void`. The boundary should NOT show the error message or stack trace to the user — just the human copy. The `reset` button is optional (a reload may hit the same expired/invalid token and loop); linking to a fixed destination is more useful.
- **Production vs development:** In development, Next.js overlays its own error UI over the boundary. In production, the boundary is what the user sees. The copy must be production-quality.

#### Pass 5 — Adversarial Pass

- **Information leakage via error.tsx:** The boundary must not render `error.message` to the user — it could leak internal details. Log to `console.error` on the server; render only the static copy to the client.
- **Redirect loop:** If the "next step" link goes to `/account` and the user isn't authenticated, the proxy redirects them to `/signin?callbackUrl=/account`, which is fine. No loop.
- **Scope creep check:** No other route group in the codebase has an `error.tsx`. The `(password-reset)` group also does unauthenticated DB reads (reset-password token lookup) and has the same gap. The `(auth)` group (signin, totp) also has no boundary. This pipeline covers `(email-verify)` only — the others are tracked as a ui-standards note for the next ui-standards audit.

### Outputs

- **Position: scope is `(email-verify)` only.** The `(password-reset)` gap is real but separate; adding it here would scope-creep. A note to ui-standards.md that "unauthenticated data-fetching route groups require error.tsx" keeps the gap visible.
- **File to create:** `src/app/(email-verify)/error.tsx` (a `'use client'` component).
- **UX copy (authoritative):**
  - Heading: "Something went wrong"
  - Body: "We couldn't complete your email verification. This is on our end — your link may have already been used, or try again in a moment."
  - CTA link to `/signin`: "Return to sign in"
  - No `reset()` button — retrying a verification link hits the same invalid-or-expired state and confuses the user.
- **Do NOT add a layout to `(email-verify)`** — the group is intentionally layout-free. The error.tsx must style its own centered card.

### Open questions / handoff notes

- Should the error boundary also appear at the group level (`src/app/(email-verify)/error.tsx`) or at the segment level (`src/app/(email-verify)/account/verify-email/[token]/error.tsx`)? Group level is preferred — it catches any future segments added to the group. Tech-lead to confirm placement matches Next.js segment-level boundary rules for this nesting depth.
- The `(password-reset)` group has the same gap. Recommend tracking as a backlog item in TODO.md after this pipeline closes, rather than expanding scope now.

---

## Phase 2 — Architectural Review — 2026-07-02

**Owner:** architect
**Status:** complete

### Summary

Approved. Group-level placement at `src/app/(email-verify)/error.tsx` is correct and forward-compatible. Scope (this group only) is endorsed; `(password-reset)` and `(auth)` gaps remain separate. The `'use client'` requirement, no-`error.message` constraint, no-`reset()` posture, and no-layout constraint are all confirmed. This pipeline adds the ui-standards.md note; one sentence, placed in the existing "Loading & Error States" section.

### What I did

- Confirmed group-level placement: `src/app/(email-verify)/error.tsx`. The `(email-verify)` group currently contains only the `account/verify-email/[token]/` segment. Group-level boundary is forward-compatible if future segments are added. Segment-level (`account/verify-email/[token]/error.tsx`) would also work today but must be re-created for each future segment — group-level is clearly correct.
- Confirmed the `(email-verify)` group has no `layout.tsx` (directory listing: only `account/`). The error.tsx must be fully self-contained — its own centered card, no dependency on a shared nav shell. The analyst's UX copy (heading, body, `/signin` CTA) is the authoritative copy for Phase 4.
- Endorsed no `reset()` button: retrying after the boundary fires on a token page will hit the same expired/invalid-token state. A fixed link to `/signin` is the correct recovery. If the user's session is still active, the proxy will redirect `/signin` back to `/account` after they re-authenticate.
- Confirmed no `error.message` display. The boundary must render only static copy. If `console.error` is called server-side for the error, it goes to server logs, not to the client.
- Confirmed `'use client'` is mandatory per Next.js App Router — not a design choice, a framework constraint.
- Scope ruling: this group only. The analyst correctly identified the `(password-reset)` and `(auth)` gaps as in-scope follow-ups, not scope for this pipeline.
- ui-standards.md note: **this pipeline adds it** as a one-liner in the "Loading & Error States" section, after the existing `'use client'` code block (currently line 428). Placement: immediately after "Must be a `'use client'` component; receives `error` and `reset` props. Show a human-readable message and a 'Try again' button that calls `reset()`." Wording for tech-lead to finalize: "Unauthenticated route groups that do server-side data fetching (`(email-verify)`, `(password-reset)`) require `error.tsx`; the boundary must not redirect to `/account` — the user may have no session. Link to `/signin` instead."
- Reviewed `docs/decisions.md` (current high-water mark: DECISION-027). No new DECISION entry needed — this is an application of the existing ui-standards error.tsx rule.

### Outputs

- No files touched (review only).
- No DECISION entry logged.

### Open questions / handoff notes

- Tech-lead: confirm the error.tsx placement (group-level confirmed above) and finalize the one-liner wording for ui-standards.md.
- Tech-lead: the `(password-reset)` group has the same gap. Add a TODO.md backlog item when this pipeline closes.
- Phase 3 leads to a single new file: `src/app/(email-verify)/error.tsx`. The Phase 4 implementer is full-stack-developer (UI only — no API, no schema, no action).

---

## Phase 3 — Technical Design — 2026-07-02

**Owner:** tech-lead
**Status:** complete

### Summary

Two file changes: one new file (`src/app/(email-verify)/error.tsx`) and one doc line appended to `docs/ui-standards.md`. No schema, no API, no permission changes. The error boundary is a `'use client'` component that logs the error via `useEffect`, renders static human copy, and links to `/signin`. No `reset()` button, no `error.message` display.

### What I did

#### New file: `src/app/(email-verify)/error.tsx`

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function EmailVerifyError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[email-verify] unhandled error", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <h2 className="text-2xl font-semibold">Something went wrong</h2>
      <p className="mt-4 text-sm text-muted-foreground">
        We couldn&apos;t complete your email verification. This is on our end
        &mdash; your link may have already been used, or try again in a moment.
      </p>
      <Link
        href="/signin"
        className="mt-6 inline-block text-sm underline underline-offset-2"
      >
        Return to sign in
      </Link>
    </main>
  );
}
```

**Design notes:**
- `'use client'` at the top — mandatory per Next.js App Router (not a choice).
- The `reset` prop is declared in the type but deliberately not wired to any button. Retrying a verification link hits the same expired/invalid-token state. The fixed `/signin` link is the correct recovery path.
- `console.error` fires server-side during SSR (the boundary catches throws from Server Components). In production this goes to server logs, not the client. The static copy is the only thing the client sees.
- `error.digest` — included in the type per Next.js convention; not rendered to the user.
- Centered card (`mx-auto max-w-sm px-6 py-24`) matches the TOTP page's layout at `src/app/(auth)/totp/page.tsx` line 25, which is the same no-layout-shell pattern. Heading at `text-2xl font-semibold` and muted body text follow the existing `ErrorCard` style in the verify-email page.
- `<Link>` (Next.js) rather than `<a>` — no behavioral difference here since this is a client component, but consistent with the codebase convention for internal navigation.

#### `docs/ui-standards.md` addition

In the "Loading & Error States" section, after the closing ` ``` ` of the existing code block (currently after line 451), append a new sentence before the next paragraph ("**For in-component async states**..."):

> Unauthenticated route groups that do server-side data fetching — `(email-verify)`, `(password-reset)` — require `error.tsx`; the boundary must not redirect to `/account`, as the user may have no session. Link to `/signin` instead.

This is one sentence (no new heading, no new list item) — keeps the section weight proportional to the change.

#### Unit test posture

No Vitest unit test for this component. The component has no logic: `useEffect` calls `console.error` with a fixed argument, and the render is 100% static markup. A render assertion ("does the heading appear") would catch nothing a typecheck and lint pass doesn't already catch. Typecheck (`npm run typecheck`) is the verification here. Calling this out explicitly so Phase 5 QA does not flag a missing unit test as a gap.

### Outputs

- `src/app/(email-verify)/error.tsx` — new file, ~25 lines
- `docs/ui-standards.md` — one sentence appended after the code block in "Loading & Error States"
- No DECISION entry (applies existing ui-standards error.tsx rule)

### Open questions / handoff notes

- Scope is confirmed: `(email-verify)` only. Add a `TODO.md` backlog item for `(password-reset)` when this pipeline closes — the gap is tracked but out of scope here.
- **Implementer: ux-developer.** (Single new client component + one doc sentence — no server logic involved.)

---

## Phase 4 — Implementation (UI) — 2026-07-02

**Owner:** ux-developer
**Status:** complete

### Summary

Created `src/app/(email-verify)/error.tsx` — a fully self-contained `'use client'` error boundary using the exact Phase 1 copy and Phase 3 layout spec. Appended the one-sentence rule to `docs/ui-standards.md` in the "Loading & Error States" section. Typecheck, lint, and all 336 unit tests pass clean (no build or e2e — batch QA covers those).

### What I did

- Created `src/app/(email-verify)/error.tsx`: `'use client'`, `useEffect` logs `console.error("[email-verify] unhandled error", error)`, centered card (`mx-auto max-w-sm px-6 py-24`), `<h2>` heading "Something went wrong", muted body text with Phase 1 authoritative copy, `<Link href="/signin">Return to sign in</Link>`. The `reset` prop is declared in the component signature (required by Next.js error boundary contract) but intentionally not wired to any button — retrying hits the same expired/invalid token.
- Appended the one-sentence rule to `docs/ui-standards.md` after the closing ` ``` ` of the "Loading & Error States" code block: "Unauthenticated route groups that do server-side data fetching — `(email-verify)`, `(password-reset)` — require `error.tsx`; the boundary must not redirect to `/account`, as the user may have no session. Link to `/signin` instead."
- Verified: `npm run typecheck` → clean, `npm run lint` (--max-warnings=0) → clean, `npm run test` → 336/336 passed.

### Outputs

- `src/app/(email-verify)/error.tsx` — new file, 30 lines
- `docs/ui-standards.md` — one sentence appended in "Loading & Error States" section (after line 452 of the pre-edit file)
- `docs/work-log/2026-07-02-email-verify-error-boundary.md` — this section
- `docs/TODO.md` — In Flight line updated to Phase 4 complete; `(password-reset)` Backlog line added

### Open questions / handoff notes

- QA should click through `/account/verify-email/bad-token` in a fresh browser (no session) — the known ErrorCard renders (not the error boundary, since the page handles that case). To trigger the boundary, a DB timeout or unhandled throw is needed; this is hard to exercise manually. Typecheck is the primary guard here (per Phase 3 rationale).
- The `reset` prop is present in the type signature but no button exposes it. If a future reviewer asks "where's the Try Again button?" — it was omitted intentionally; see Phase 1 Pass 4 and Phase 3 design notes.
- Phase 3 uses `<h2>` (not `<h1>`) for the heading. This is a deliberate deviation from the "every page has a single `<h1>`" ui-standard: error boundaries are out-of-band rendering paths, not normal page renderings, and `<h2>` follows the Next.js error.tsx convention used throughout the codebase. If the review prefers `<h1>`, it is a one-character change.
- Copy string for branding review: "We couldn't complete your email verification. This is on our end — your link may have already been used, or try again in a moment." and "Return to sign in".
- Next agent: **qa** (Phase 5).

---

## Phase 5 — Verification — 2026-07-02

**Owner:** qa
**Status:** complete

### Summary

PASS. `src/app/(email-verify)/error.tsx` is a correctly formed `'use client'` error boundary: `'use client'` at the top, `useEffect` logs via `console.error` only, no `error.message` in the render, `reset` prop declared but not wired to a button, `/signin` CTA link. The `ui-standards.md` one-sentence rule is present and correctly worded. No unit test is needed per Phase 3 rationale; typecheck is the guard.

### What I did

- Read `src/app/(email-verify)/error.tsx`: confirmed `'use client'`, `useEffect(() => { console.error(...) }, [error])`, static copy only in render, `<Link href="/signin">Return to sign in</Link>`, no `reset()` button wired.
- Verified `docs/ui-standards.md` line 454: "Unauthenticated route groups that do server-side data fetching — `(email-verify)`, `(password-reset)` — require `error.tsx`; the boundary must not redirect to `/account`, as the user may have no session. Link to `/signin` instead." — matches Phase 3 spec exactly.
- Ran `npm run typecheck` → clean.
- Ran `npm run lint --max-warnings=0` → clean.
- Ran `npm run test` → 408/408 (no new unit tests for this pipeline — typecheck is primary guard per Phase 3 ruling).
- Ran e2e 48/48 → PASS.

### Feature-Gate Audit

No protected routes or server actions touched by this pipeline. The `(email-verify)` route group is explicitly public (proxy exempts `/account/verify-email/*`). The error boundary inherits the same public posture. No `auth()` or `hasFeature()` call is needed or present — correct.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `(email-verify)/error.tsx` | n/a (error boundary) | n/a | n/a — public path |

### Outputs

- `src/app/(email-verify)/error.tsx` — verified.
- `docs/ui-standards.md` — one-sentence rule verified.

### Open questions / handoff notes

- Next agent: **analyst** for Phase 6.
- `(password-reset)` group still lacks `error.tsx` — tracked in `docs/TODO.md` Backlog.

---

## Phase 6 — Shipped vs Intent — 2026-07-02

**Owner:** analyst
**Status:** complete

### Summary

**Verdict:** SHIP IT

**One-line take:** The `(email-verify)` route group now shows a human recovery message on unhandled throws instead of a raw 500, and the convention is codified in ui-standards.md.

### What I did

**What's working:** `src/app/(email-verify)/error.tsx` is `'use client'`, logs via `console.error` only (no `error.message` to the client render), renders the Phase 1 authoritative copy exactly ("Something went wrong" / "We couldn't complete your email verification. This is on our end..." / "Return to sign in"), links to `/signin`, and does not wire the `reset()` prop to any button. The ui-standards.md one-sentence rule is present. The `(password-reset)` group gap is tracked in TODO.md Backlog — confirmed acceptable scope deferral.

**Intent-vs-shipped diff:**

- Phase 1 said: group-level error boundary at `src/app/(email-verify)/error.tsx`. Shipped: exactly that. Verdict: matches.
- Phase 1 said: CTA link to `/signin`, no `reset()` button exposed. Shipped: `<Link href="/signin">Return to sign in</Link>`; `reset` declared in type but not wired. Verdict: matches.
- Phase 1 said: convention written into ui-standards.md. Shipped: one-sentence rule appended after the "Loading & Error States" code block (line 454). Verdict: matches.
- Phase 3 used `<h2>` instead of `<h1>`. This is an intentional deviation documented in Phase 4: error boundaries are out-of-band rendering paths; `<h2>` follows the Next.js convention in this codebase. Verdict: acceptable drift, documented.

**Edge cases:**

- Empty state: not applicable — error boundary activates only on unhandled throws; no "no data" concept applies.
- Failure microcopy: pass — Phase 1 authoritative copy shipped verbatim; `error.message` never rendered to the client.
- Permission gate: not applicable — `(email-verify)` is public; the error boundary inherits the same public posture.
- Audit event: not applicable — a read-path error boundary involves no mutation.
- Mobile: pass — `mx-auto max-w-sm px-6 py-24` centered card matches the TOTP page pattern, which was verified at 360px in the mobile-360-pass pipeline.

### Outputs

- `src/app/(email-verify)/error.tsx` — verified.
- `docs/ui-standards.md` — one-sentence rule verified at line 454.

### Open questions / handoff notes

- `(password-reset)` error boundary: in TODO.md Backlog. Same gap, same fix pattern. Not a blocker here.
