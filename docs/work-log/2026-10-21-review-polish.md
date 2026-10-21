# Operator production-review polish — Work Log

> **Slug:** `2026-10-21-review-polish`
> **Surface:** mixed — `(auth)` (/signin, /totp), `(admin)` (/admin/organizations), all outbound email
> **Permission(s):** existing keys cover this (TBD Phase 1)
> **Flag(s):** none — no new platform flag pre-live (operator rule)
> **Estimated complexity:** medium
> **Pipeline mode:** Full (auth-touching: MFA e2e smoke required before Phase 5)
> **Source — operator production test checklist** (artifact XkmzY5sjrtTxkkRKFVyoNZ, `results` collection, 2026-10-21). The operator's notes, verbatim:
> - step 1.1: "It would be nice if the google link on the signin page actually used google colors so it pops for people.  Also it would be nice if all maintainence emails (all emails) are rich html."
> - step 1.3: "2 factor auth should use the box per number ux design.  focus should always go to the first box when the page is rendered.  delete key should work across boxes"
> - step 2.1: "i wonder if the organizations page should be hierarchitcal in nature.  and filterable.  i almost want to be able to flag organizations as test organizations as well.  it would be nice to have a test organization in production that i could turn feature flags on and test stuff before rolling out to other organizations."

---

## Kickoff (orchestrator, 2026-10-21)

The operator asked (2026-10-21, while the invitations pipeline runs) to "work on the small notes i have made in my review so far". Scope of this pipeline — four items:

1. **Google sign-in button in Google's own colours** (`src/app/(auth)/signin/page.tsx`). Note the existing comment there: the button is `data-brand-neutral` and "never recolored" because Google's guidelines forbid recolouring — Google's *standard* button (white/light or dark surface, the four-colour "G" mark, Roboto-ish label) is what the guidelines prescribe, so this is plausibly *more* compliant, not less.
2. **Rich HTML for every outbound email** — a shared, platform-palette HTML layout (header, body, footer, plain-text alternative) that every sender uses: account, feedback, tickets, password reset, statistics grants, ticket notifications, domains notify, giving statements, anything else that calls `src/lib/email`. Invitations (pipeline/invitations, in flight) will add an `account_invitation` email; it adopts the layout at its own integration — do not edit that pipeline.
3. **Per-digit 2FA code entry on `/totp`** — one box per digit, focus on the first box at render, Backspace/Delete moving across boxes, paste of a full code, mobile numeric keyboard and one-time-code autofill. Must stay accessible and must honour the HydrationGate invariant if it is a `useForm` root (DECISION-159).
4. **`/admin/organizations` hierarchical and filterable** — show the council tree (synod → presbytery → congregation, from the derived `parent_id`/`path` cache) and filter by name/type/status. Platform admin page (`getPlatformDb()` is legal there).

**Out of scope, deferred to the operator:** the "test organization" flag (step 2.1, second half). It is a new concept with schema and flag-semantics consequences (does a per-org "test" mark bypass global flags? does it exclude the org from statistics/publication?), not a small note — written up as a TODO line and a question at integration.

**Pre-assigned numbers (Rule 16):** no migration expected (if one becomes necessary, stop and ask the orchestrator — `0058` is Track F mail, `0059` invitations, next free is `0060`); DECISION-190–193; F160–F165.

**Environment:** worktree `../presby-polish`, branch `pipeline/review-polish` from `main` 86dd835; Neon branch `pipeline-review-polish` (`br-tiny-bonus-axggop3n`, endpoint `ep-bold-brook-ax3w7dn8`, child of `development`), `.env.local` points there. Dev server port **3600** (invitations uses the default); prod-build lane `PW_PROD_PORT=3900`.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-21 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-21 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementers named per batch | 2026-10-21 |
| 4 — Implementation | A ux-developer · B full-stack-developer · C ux-developer · D api-developer | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

*2026-10-21, analyst (read-only; recorded verbatim by the orchestrator).*

## VERDICT

**READY WITH NOTES.** The four items are real, in scope, and need no new schema, permission or flag.

No item needs to be split into a separate pipeline.

- **Email layout is the largest item.** It is medium: about 12 call sites, a plain-text alternative, and some pre-existing escaping bugs.
- **`/totp` is small-to-medium.** The page also accepts recovery codes, which the request didn't mention. Three e2e specs also depend on its current markup.
- **Google button and org tree are small.** Org tree is small-to-medium if the filter UX is left open.
- **Sequencing.** Run it as one pipeline in four batches, with email last. That way the email batch can be pushed to a follow-up without blocking the other three. That is the only split I would allow.
- **Out of scope as agreed.** The "test organization" flag stays out. Nothing here should add placeholder UI for it.

## ONE-LINE TAKE

> Four independent polish items. The one that bites is `/totp`, because the single field also carries recovery codes and a naive six-box replacement locks out recovery-code users.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Anonymous visitor (`/signin`) | Spots and clicks "Sign in with Google" | per session |
| Authenticated, 2FA-required but unverified (`/totp`) | Types or pastes six digits and presses Verify | per session |
| Same | Backspaces or Deletes across boxes, and arrows between them | per session, on typos |
| Same | Switches to "use a recovery code" and types `ABCD-EFGH` | rare, but it is the lockout escape hatch |
| Anyone with an account, or a non-account recipient | Reads mail (reset, email-change, statistics grant, ticket, feedback, domain notice, giving statement notice) and taps the button or link | per event |
| Platform admin (`/admin/organizations`) | Scans the council tree and expands or collapses it (if built) | on demand |
| Same | Types in a name filter and picks type, status, branded | on demand |
| Same | Shares or bookmarks a filtered URL | occasional |
| Same | Clicks "Manage" on a row | on demand |

All surfaces are named. None of these verbs is new surface area.

## Flows

**Flow 1 — Google sign-in.** `/signin` → sees a recognisable Google button → click → the existing server action calls `signIn("google", { redirectTo: callbackUrl })` → Google → `/launch`.
- Failure: the page renders only `deactivated` and `CredentialsSignin` errors. An OAuth failure such as `AccessDenied` or `OAuthAccountNotLinked` renders nothing (the page ignores any other `?error=`). That is adjacent to this request, not part of it. See Gaps.

**Flow 2 — 2FA, authenticator code.** Sign-in → proxy sends to `/totp?callbackUrl=…` → page renders and focus is on box 1 → type or paste six digits → Verify or Enter → `verifyTotpAction` (unchanged) → redirect to the sanitized callbackUrl.
- Failure: `invalid` and `rate_limited` come back as `?error=` on a full page load. Boxes are cleared and focus returns to box 1. The error text is announced (`role="alert"`). The code is never echoed into the URL.

**Flow 3 — 2FA, recovery code.** `/totp` → "Use a recovery code instead" → single text field, same `token` name, same action → success or the same invalid error.
- Failure: the same page, with focus in the recovery field.

**Flow 4 — Outbound email.** A user action or system event → caller builds a message → layout wraps it (HTML plus a generated plain-text part) → `enqueueEmail()` stores the rendered HTML at rest (DECISION-018) → send.
- Failure: unchanged. Send failure retries via the queue. Callers already swallow enqueue errors and log.

**Flow 5 — Organizations tree.** `/admin/organizations` → the council tree renders, nested by `parent_id` → the admin filters by name, type, status or branded, with filters in the URL via a GET form → clicks Manage.
- Empty (no orgs at all): "No organizations yet." with a "New organization" button.
- Empty (filters match nothing): "Nothing matches these filters" plus a "Clear filters" link.
- Failure: an unreachable DB currently throws to the segment `error.tsx`. Confirm one exists; the checklist requires it.

## Permissions & Flags

- **Permission(s):** all existing.
  - `/signin` and `/totp` have none: anonymous, and signed-in-unverified.
  - `/admin/organizations` stays on `FEATURES.ADMIN_ORGANIZATIONS` with the inline denial it has today.
- **Flag(s):** none. This follows the operator's rule of no new platform flags before go-live.
  - `ui.branded_signin` still governs the signin brand and is unaffected.
  - Rollback is a plain revert. No data is migrated, and `email_queue` keeps already-rendered HTML.
- **Schema:** none expected. No migration number is needed. If a change turns out to need one, stop and ask the orchestrator, as the Kickoff says.

## Gaps the Request Didn't Address

**Item 1 — Google button**

1. **A rule conflict.**
   - `ui-standards.md` bans palette literals ("tokens only"). The Pre-merge checklist repeats it.
   - Google's four brand colours and the `#1F1F1F` / `#747775` neutrals are literals by definition.
   - Phase 3 needs an explicit exemption: a named constants file or CSS custom properties, a DECISION from the reserved range, and a one-line note in ui-standards. Without it, QA's checklist item will fail on a correct implementation.
2. **The existing comment is stale after this change.**
   - The "never recolored" comment in `signin/page.tsx` cites Google's guidelines. Official Google styling follows those guidelines, so it is arguably more compliant.
   - Colours that are literals can no longer be repainted by `--primary`, so the neutral wrapper is no longer needed for colour. It is still harmless for the focus ring, which is brand-driven by design.
   - Update the comment rather than delete the wrapper. `brand-tokens.tsx`'s `[data-brand-neutral]` reset is shared machinery.
3. **Dark mode.**
   - The app has a `.dark` class. Google publishes light and dark variants.
   - The button needs both, switched with `dark:`. Otherwise a white button glares in dark mode.
4. **"Pops" expectation.**
   - The official light button is white with a thin grey border and a coloured "G". On a white page it will not look more prominent than today's solid primary button. The colour comes from the mark only.
   - Confirm that is what the operator wants. See Open Questions.
5. **Standard compliance details.**
   - Use the official "G" SVG inline, marked decorative (`aria-hidden`), with the visible label text unchanged.
   - Keep a 44px touch target per ui-standards, even if Google's published minimum is 40px.
   - All four states are required: default, hover, active, disabled. Add the offset focus ring.
   - Contrast: the label must meet 7:1 and the control border 3:1.
6. **Adjacent finding, not requested.**
   - `/signin` shows "First time? Run `npm run db:seed` to provision the seeded admin user." whenever local login is on. That is developer copy on a production sign-in page.
   - Flag it for the operator. Do not silently fix it in this pipeline unless the operator agrees.

**Item 3 — 2FA boxes**

7. **Recovery codes (the big one).** The current field is labelled "6-digit code or recovery code" and the action routes on shape. Six numeric boxes cannot take `ABCD-EFGH`.
   - The design must keep a recovery path: a visible, keyboard-reachable toggle to a single text input.
   - Omitting it locks out anyone who has lost their authenticator.
8. **Hydration.**
   - `/totp` is a native server-action form, not a `useForm` root, so `check:hydration-gate` will not force `HydrationGate`. The underlying hazard still applies.
   - If digits live in client state and are joined into a hidden `token` field, typing before hydration sends an empty `token`. The action then counts it as a failed attempt, writes a `TOTP_VERIFY_FAILED` audit event, and uses up one of the 10/min rate-limit slots.
   - Recommendation: wrap in `HydrationGate`, as the codebase does elsewhere. A disabled fieldset cannot take focus, so "focus first box at render" must happen in an effect when hydration completes, not via the `autoFocus` attribute. Add a `/totp` spec to `e2e/hydration/`.
9. **The e2e specs will break.**
   - `totp-full-login`, `totp-callback-bypass`, and any other spec using `getByPlaceholder(/123456/)` locate the field by placeholder.
   - Replace this with a shared helper in `e2e/support/` rather than patching each spec, and keep the box DOM stable enough for it.
   - The MFA-enrolled e2e is mandatory before Phase 5 anyway.
10. **Auto-submit on the sixth digit** was not asked for.
    - Auto-submitting after a typo burns one of 10 attempts, and it surprises screen-reader users.
    - Default: do not auto-submit. After the sixth digit, move focus to Verify. Enter submits.
11. **Double-submit.** Disable Verify with a pending state on submit. The action has a rate limit but no idempotence.
12. **The enrolment sibling.** `/account/2fa` has a similar single six-digit field in `totp-enroll-form.tsx` (a client form that uses a toast). Operator said "2 factor auth", not "/totp". Build one shared component. Using it there too is cheap and avoids two different code-entry experiences. See Open Questions.
13. **Accessibility.**
    - Group the boxes with `role="group"` and a visible label.
    - Each box gets an accessible name ("Digit 1 of 6").
    - Errors use `aria-invalid` plus `aria-describedby` and a `role="alert"` message.
    - Visible focus ring with offset. Boxes at least 44px, which fits at 360px (6×44 + gaps inside the 312px content width) and survives 200% zoom. Do not rely on border colour alone to signal an error.

**Item 2 — Email**

14. **Existing senders and what they do today.** About 12 template keys: `email_change_verify`, `password_reset`, `feedback_notification`, `ticket_filed_confirmation`, five `ticket_*` events, `statistics_submission_grant`, `domain_notification`, and `giving.statement.notice`. Most are hand-written `<p>` fragments.
    - Feedback and ticket emails have no plain-text part at all.
    - The deprecated `sendPasswordResetEmail()` in `send.ts` has no callers. Delete it or route it through the layout; do not leave a third stale template.
15. **Pre-existing bugs the layout work will walk past.** Fix them in the same batch.
    - `email_change_verify` interpolates `newEmail` unescaped into HTML (`<strong>${newEmail}</strong>`). That is an HTML-injection path from user input.
    - The ticket and feedback senders pass `subject: escapeHtml(...)`. A subject is a plain-text header, so "Q&A" arrives as "Q&amp;A". Subjects should be raw, with CR/LF stripped, as the giving notice already does.
    - The statistics grant's `toDateString()` produces a server-timezone date label. Minor.
16. **Where the layout is applied.** DECISION-018 stores rendered HTML at rest, so the layout must be applied before or inside `enqueueEmail`.
    - `enqueueEmail` is the single choke point, but auto-wrapping risks double-wrapping or breaking the in-flight invitations pipeline.
    - See Open Questions. Whichever is chosen, "all emails" needs a guard so a thirteenth template cannot ship unwrapped. A source-scan test is the repo's usual form.
17. **Giving notice constraints (B5).** The notice test asserts no amounts: no `$`, no `\d+\.\d{2}`, no thousand separators. The doc comment says "no digit but the tax year".
    - Layout CSS such as `line-height:1.25` or `font-size:0.85em` would match `\d+\.\d{2}`, and a "© 2026" footer would add a digit.
    - Either keep the assertion on the body fragment, or keep layout CSS and footer free of those patterns. Decide at design time, not at QA failure.
    - The privacy copy ("this message does not list any gifts") must survive.
18. **Layout content rules.**
    - Platform palette only. Inline styles, table-based, about 600px.
    - No remote images by default. Use a text wordmark ("PresbyPortal", per the naming rule) so blocked images still look right.
    - A bulletproof button, plus the raw URL printed beneath it. Today's emails print the URL, and that is the accessible fallback.
    - Include a hidden preheader.
    - The footer has a "why you got this" line. No real addresses or phone numbers (No Real Data invariant), and no unsubscribe, since these are transactional.
    - Sender display name: `.env.example` and the `send.ts` default say "presby <…>" while `docs/deployment.md` says production is `PresbyPortal <noreply@presbyportal.org>`. Confirm the production env value. Update the `.env.example` and fallback strings to PresbyPortal.
19. **Dark mode in mail clients.**
    - Many clients force-invert. Use explicit `bgcolor` plus `color` on every block.
    - Declare `color-scheme: light dark` and `supported-color-schemes`.
    - Do not use a transparent PNG logo.
    - Check the result in at least Gmail and Apple Mail dark mode by eye. Unit tests cannot cover this.
20. **Admin tooling and queue.**
    - Check that `/admin/email-queue` rendering is unaffected. `htmlBody` is stored, but only `templateKey` and status appear to be shown.
    - Rows already queued keep their old HTML. No backfill.

**Item 4 — Organizations tree**

21. **"Status" is ambiguous.** `organizations` has three: `platform_status` (managed, unmanaged, invited), `lifecycle_status` (active, merged, divided, dismissed, dissolved), and the legacy `status`. The page shows `platformStatus` today. Filter on `platformStatus`, and show a visible badge when `lifecycleStatus` is not `active`. A dissolved congregation must not look live in the tree.
22. **Tree derivation.**
    - `parent_id` and `path` are a derived cache of `organization_affiliations` (D19), never written directly. This page must only read them.
    - Nest by `parent_id`. Do not parse `path`; it is an `ltree` text column. The tree is built in memory from one flat query, as the page already fetches all rows.
    - Orgs with no parent (GA, synods, unaffiliated congregations) are roots.
    - Sort siblings by name. Order roots by type rank, then name.
23. **Filtering a tree.**
    - A filtered match must still show its ancestors as context. Otherwise "Alder Creek" appears orphaned from its presbytery.
    - Matches are emphasised and ancestors rendered de-emphasised, not selectable.
    - The existing "Still on default palette" toggle is also a filter. Keep `?filter=unbranded` working, because it is the OQ4 report and may be bookmarked.
24. **Collapse and expand.**
    - CLAUDE.md records an iOS bug where `display` on `<summary>` breaks `<details>`. Use `<details>` only if verified on a phone viewport.
    - The safe v1 is always-expanded, indented rows with no collapse control. See Open Questions.
25. **Scale.**
    - The page today is unbounded, one query. That is fine for current production. Once presbyteries load their rolls of unmanaged congregations (D9), this table can grow to thousands of rows.
    - Don't solve it now. Add a visible row-count cap with "Showing first N, narrow with filters" and a TODO line, so the page degrades honestly rather than going quiet.
26. **Mobile.** At 360px a six-column table with indentation overflows. Hide secondary columns below `sm`, or make the table scroll within a container. Indentation must not push the name off-screen. Use a capped indent step and a left-border guide.
27. **What each row shows.** Name plus indent, type (the existing label), `platformStatus`, a branded badge, last updated, and Manage. It needs a count of children per node, e.g. "12 congregations", to make the hierarchy worth having.

## Adversarial pass

**`/totp` and `/signin`**
- **Redirect targets.** `callbackUrl` stays a hidden field and is re-sanitized in the action (`sanitizeCallbackUrl`). The boxes must not change that. Confirmed today. Keep `totp-callback-bypass.spec.ts` passing.
- **Code in the URL.** Failure redirects carry only `callbackUrl` and `error`. Do not add a "preserve entered digits" feature that puts a code in the query string or logs.
- **State-machine shortcut.** Client boxes are convenience only. The action still validates `^\d{6}$` or the recovery-code shape, and still rate-limits at 10/min per user. Don't move any validation to the client.
- **Paste and autofill.**
  - Pasted text may contain spaces, hyphens, a newline, or full-width digits. Strip to ASCII digits only and take the first six.
  - Reject non-digits silently in the boxes, but never send a mangled value.
  - A multi-character `input` event (iOS one-time-code autofill, Android keyboard suggestion) must be distributed across boxes. `maxLength=1` on the first box would block that fill.
  - Put `autocomplete="one-time-code"` on the first box (or all), and `inputmode="numeric"`. Also set `pattern="\d*"` and keep `type="text"`, not `number`. `type=number` strips leading zeros and adds spinners.
- **Enumeration.** The error text is already uniform. Recovery and authenticator failures show identical copy, and the new toggle must not distinguish them either.
- **Input boundaries.** Server-side validation exists. An empty or short submit must still return the generic invalid message. Verify is disabled in the client until six digits are present (recovery mode: non-empty).
- **Self-targeting.** Not applicable.
- **Google button.** The form posts a fixed provider with a sanitized `redirectTo`, no change.

**Email**
- **XSS in the new layout.** The layout adds new interpolation points (heading, preheader, button label, button `href`). Escape all of them. Validate the `href` as an absolute `http(s)` URL before it goes into an attribute, so a `javascript:` URL can never be built.
- **Header injection.** Strip CR/LF from every subject and from any display name that reaches a header. The giving notice does this today. The other senders do not.
- **Secrets at rest.** The queue keeps rendered HTML indefinitely, and the reset and verify emails already contain live tokens in their links. The layout must not add anything beyond today's content. Do not add org-private details to a shared chrome.
- **Plain-text part.** Generate it from structured content, not by stripping HTML. Crude tag-stripping mangles links and entities. Every email, including feedback and tickets, gets one.
- **CSS-stripping clients.** Gmail drops `<style>` in some contexts. Use inline styles only. The mail must read acceptably as unstyled HTML.
- **Phishing look-alike.** A rich branded layout makes a forged "reset your password" more convincing, so keep the printed URL visible and the sender name consistent.

**Organizations**
- **Input boundaries (server-side).**
  - Filter params arrive from the URL as `string | string[] | undefined`. Allow-list `type` and `status` against known values. Ignore unknowns rather than passing them to a pg enum comparison, which would 500.
  - Trim and cap `q` at about 100 characters, and match case-insensitively. Never put it in a raw SQL pattern without escaping `%` and `_`. Filtering in memory is simpler and avoids this.
  - Unicode: compare case-folded and NFC-normalized.
- **Enumeration.** Not a concern here: this is a platform-admin page, and `organizations` is public-tree data by design.
- **Self-targeting.** Not applicable.
- **Filter state in URL.** A plain GET form means shareable and bookmarkable URLs, and it works without JavaScript. It is not a `useForm` root, so no `HydrationGate`. Do not hold filter state only in client state.
- **Derived-cache staleness.** `parent_id` can lag a transfer only if the trigger path is bypassed. Don't "repair" the cache from this page, and don't write it.
- **Cycles.** The tree builder must not assume acyclicity. Guard against infinite recursion even though the schema should prevent cycles.

## Out of Scope (confirm with user)

- The "test organization" flag, per-org feature-flag gating, and excluding test orgs from statistics or publication. Already deferred, and needs its own scoping.
- Branding `/totp`, `/forgot-password` or `/reset-password` (DECISION-094 keeps them platform chrome).
- Per-organization email branding or per-org sender. The layout is platform palette. Org-branded mail belongs to Track F mail.
- Editing the invitations pipeline's `account_invitation` email. It adopts the layout at its own integration.
- Rendering a SAML/OAuth error page for the other `/signin?error=` values.
- Any new email types, digests, or unsubscribe handling.
- A real tree control (drag, reparent, org detail from the tree). Reparenting goes through the affiliation functions, never this page.

## Open Questions (recommended default in bold)

1. **Google button style: accept official light/dark styling?** **Recommended default: yes.** White surface (dark surface in dark mode) with the official four-colour "G" and a thin neutral border. A saturated blue-filled button is not what current Google guidance prescribes. Confirm with the operator that "pops" means the coloured mark, not a filled button.
2. **`/totp` recovery code access.** **Recommended default: a "Use a recovery code instead" text button under the boxes, swapping to the existing single field, and back.** Server action untouched.
3. **Auto-submit on the sixth digit?** **Recommended default: no.** Focus moves to Verify and Enter submits. Revisit if the operator wants it.
4. **Apply the digit boxes to `/account/2fa` enrolment too?** **Recommended default: yes, via the one shared component.** It is a client form with a toast, so it needs no `HydrationGate`. If the architect finds the auth-touching boundary uncomfortable, drop it to a TODO line.
5. **Where is the email layout applied?** **Recommended default: an explicit `renderEmail()` builder in `src/lib/email/` that each caller uses and that returns `{ html, text }`, plus a source-scan test that every `enqueueEmail` call uses it.** Do not auto-wrap inside `enqueueEmail`. Let the architect overrule if a single choke point is judged safer.
6. **Layout footer and the giving notice.** **Recommended default: no year or digits in the shared footer, and layout CSS that avoids `\d+\.\d{2}`.**
7. **Tree: collapse and expand, or always expanded?** **Recommended default: always expanded with indentation in v1.**
8. **Tree filters.** **Recommended default: name search, type select (native `<select>`, per ui-standards), status select on `platformStatus`, and the existing branded toggle. Matches show their ancestors dimmed.**
9. **Row cap for large lists.** **Recommended default: a soft cap (about 500 rows) with an honest message, plus a TODO.** No pagination in v1.
10. **Production sender display name.** **Recommended default: confirm `RESEND_FROM_EMAIL` in production is `PresbyPortal <noreply@presbyportal.org>`, and change the "presby" strings in code and `.env.example`.**
11. **The `npm run db:seed` hint on `/signin`.** **Recommended default: report it to the operator and let them decide.**

## Recommended batch order

Four batches, email last (so it can slip to a follow-up without blocking the others): Google button → `/totp` digit boxes (+ `/account/2fa`) → organizations tree → email layout.

## Handoff

Next: **architect (Phase 2).** Rule on: shared client component placement for the digit boxes (`src/components/shared/`) and the `HydrationGate` decision for `/totp`; where the email layout lives and how it is enforced; where the Google brand-colour exemption lives (constants file or CSS properties, plus a DECISION from the reserved range); the palette-literal ban and the QA checklist item it affects; the org-tree reading strategy. Phase 3 inputs: gaps 5 and 13 (four states, a11y), gap 15 (escaping, subjects), gap 17 (B5), gaps 8–9 (`e2e/support/` helper, `/totp` hydration spec), the mandatory MFA-enrolled e2e before Phase 5, and an error-boundary check for `/admin/organizations`.


---

# Phase 2 — Architectural Review (architect)

*2026-10-21, architect (read-only; recorded verbatim by the orchestrator).*

## Verdict

**Approved with suggestions.**

All four items fit the existing structure. None needs a migration, a new permission, a new flag, a new top-level module, a new route group or a new dependency. I accept the orchestrator's provisional Q1–Q11 defaults with three changes:

- **Q4 is accepted, but the enrolment form also gets `HydrationGate`.** Phase 1 said it needed none.
- **Q5 is accepted, with a stronger guard.** "Every email uses the layout" is enforced by a branded type on `enqueueEmail`'s input, not only by a call-site source scan.
- **Q1 is accepted, with one recorded departure.** We do not load Google Sans.

Two pieces of repo tooling constrain the email layout's markup. Phase 1 did not mention them, so Phase 3 must design around them (R12).

## Placement

**Directory placement**

*Item 1, Google button*
- New file `src/app/(auth)/signin/google-sign-in-button.tsx`, kept next to the page because only `/signin` uses it.
- The server-action `<form data-brand-neutral>` stays in `page.tsx`.

*Item 3, per-digit code entry*
- The shared code box goes in `src/components/shared/one-time-code-input.tsx`, with a test file beside it. It is used by two surfaces, `(auth)/totp` and `(account)/account/2fa`, so it is cross-cutting. It does not go in `src/components/ui/`, which is generated.
- New file `src/app/(auth)/totp/totp-challenge-form.tsx`, kept next to the page. It is a client file holding the mode toggle, the hidden fields, and Verify.
- `src/app/(account)/account/2fa/totp-enroll-form.tsx` is edited in place.

*Item 2, email layout*
- New file `src/lib/email/render.ts`, plus `render.test.ts`, inside the existing DECISION-018 directory.

*Item 4, organizations tree*
- New file `src/app/(admin)/admin/organizations/org-tree.ts`, plus its test, kept next to the page. It holds the pure tree builder and the filter parser.
- `page.tsx` is edited in place.

**Server vs Client split**

- **`/signin`:** unchanged; Server Component. The Google button is a Server Component, a plain submit inside the existing server-action form.
- **`/totp`:**
  - `page.tsx` stays a Server Component (session, enrolment check, `callbackUrl` sanitising).
  - Only `totp-challenge-form.tsx` and `one-time-code-input.tsx` carry `'use client'`. They need refs, focus control, digit state and `useFormStatus` for the pending state.
- **`/account/2fa`:** already a client form; no change of side.
- **`/admin/organizations`:** stays a Server Component with **no** client code. Filters are a plain `<form method="get">`.
- **Email:** `render.ts` is pure server-side TypeScript with no React. See R9 for why it must not import `server-only`.

**Dependencies:** none.

- No `input-otp`, and no shadcn `InputOTP`. That primitive needs the `input-otp` package, which `npm run ui:add` would rightly stop on as an unvetted package.
- No Google Identity Services script.
- No font package or new `next/font` load.
- No email-templating library.

The code box is built by hand, using the generated `<Input>` primitive (R3). If Phase 4 shows that a hand-built version cannot meet the iOS one-time-code autofill and paste requirements, the work comes back to Phase 2 for a dependency addendum. It must not be installed ad hoc.

## Invariants Touched

- **Permissions vs Flags (DECISION-003).**
  - Respected. `/admin/organizations` keeps its page-level `hasFeature(…, FEATURES.ADMIN_ORGANIZATIONS)` check and inline denial.
  - `/signin` and `/totp` stay permission-free by design.
  - No flag is added, per the operator's no-new-flags-before-go-live rule. `ui.branded_signin` is untouched.
- **The Proxy Does Not Reach the Database (DECISION-177).** Respected. `src/proxy.ts` is not touched, and its public and 2FA path lists are unchanged.
- **The Brand Is a Cascade Override (DECISION-046/047/094).**
  - Respected. `/totp` and `/account/2fa` stay in the platform palette.
  - The Google button's colours are set on the element itself, so no brand redeclaration can reach them.
  - `data-brand-neutral` stays (R6).
  - `check:brand-scope` E1, E2 and C1 are unaffected. E3 and C2 constrain the email layout's markup (R12).
- **Verify in a Browser / HydrationGate (DECISION-159).**
  - Extended, not weakened: a non-`useForm` form whose submitted value depends on hydration is now gated, and the tripwire learns it (R4, R5).
  - Cost: `/totp` loses its no-JavaScript path. In practice this is not a regression, because the credentials sign-in form that precedes it already needs JavaScript (`onSubmit`).
- **Two Hierarchies Intersect Nowhere / derived council cache (D19).**
  - Respected. The tree reads `organizations.parent_id` through `getPlatformDb()` as display data only. The org tree is public (DECISION-040).
  - No authority check, action or link may be derived from a row's position in the tree (R14).
  - I checked the live catalog on `pipeline-review-polish`. `organizations_guard_reparent` exists on `organizations` and `organization_affiliations_apply` exists on `organization_affiliations`, so the cache is trigger-maintained and direct writes are refused by the database, not just by this page.
  - The data is not a single-rooted tree: 1 synod, 5 presbyteries of which 4 are roots, 9 congregations of which 1 is a root, and 0 dangling `parent_id`s. Multiple roots are the normal case.
- **Isolation Is a Database Property.** Not affected. There is no tenant-connection read and no `withOrgContext()` on these surfaces. `getPlatformDb()` is legal on an `(admin)` page and stays out of `(org)`.
- **Email at rest (DECISION-018, DECISION-173) and the sender registry (DECISION-182, accepted, not built).**
  - `email_queue` still stores rendered HTML.
  - The layout adds no data beyond today's content, and it adds no sender choice (R11).
- **No Real Data.** The email footer and the wordmark carry no address, phone number or real name. `check:secrets` applies to `render.ts`.
- **Schema, RLS and grants:** untouched. That is why this review read the live catalog only to check the tree-cache premise.

**CLAUDE.md update needed at integration (orchestrator):** the `npm run check:hydration-gate` line under Common Commands currently says "every useForm root renders <HydrationGate>". It must also name the H3 rule (R5). No invariant text changes.

## Binding rulings for Phase 3

### Item 3: per-digit code entry

**R1. One shared component, owned by neither surface.**
- `OneTimeCodeInput` in `src/components/shared/one-time-code-input.tsx` is UI only. It imports no server action, auth module or route code.
- It does **not** contain the recovery-code toggle. That is specific to `/totp` and lives in `totp-challenge-form.tsx`, because the enrolment form has no recovery mode.

**R2. Contract points Phase 3 must keep:**
1. **One source of truth.** The component emits the joined value through exactly one hidden `<input name={name}>`. The individual boxes carry **no `name` attribute**, so neither a native submit nor a browser's form autosave ever produces six fields or a partial code.
2. **Focus on mount is a prop, `autoFocus`, and is off by default.** `/totp` turns it on. `/account/2fa` leaves it off: the code box sits below the QR instructions, and grabbing focus on a phone scrolls past them and covers the QR code with the keyboard.
3. **Focus happens in an effect keyed on `useHydrated()` becoming true,** never through the `autoFocus` HTML attribute. A disabled fieldset cannot take focus.
4. **An `onComplete` callback** lets the caller move focus to its own submit button. No auto-submit (Q3).
5. **Input handling (the Phase 1 adversarial list):**
   - A multi-character `input` event (autofill or paste) is spread across the boxes.
   - Input is stripped to ASCII digits, including full-width digits after NFKC normalisation.
   - Boxes are `type="text"`, `inputMode="numeric"`, `autoComplete="one-time-code"`.
   - Nothing is validated only on the client; the server action stays the authority.

**R3. Boxes render the generated `<Input>` primitive.**
- No raw `<input className="border border-input …">`; that would break Component Rule 5.
- Box size, centred text and the 44px minimum are set in the one shared component's `className`. That is one place, not repeated at each call site.
- `src/components/ui/input.tsx` is not edited.

**R4. `/totp` gets `HydrationGate`.**
- `totp-challenge-form.tsx` wraps its `<form>` from the outside in `<HydrationGate>`, so the boxes, the toggle and Verify are disabled until hydration.
- Without it, a Verify pressed before hydration posts the server-rendered empty `token`. That writes `TOTP_VERIFY_FAILED` and uses up one of the 10-per-minute rate-limit slots.
- **The enrolment form also gets `HydrationGate`.** This overrules Phase 1's "needs no gate". Its `onSubmit` handler does not exist before hydration, so a submit then is a native GET reload, and digits typed before hydration are out of step with React state. The cost is nil, because the QR code itself is only generated after hydration.

**R5. Extend `check:hydration-gate` with rule H3.**
- Any non-test `.tsx` file that imports `@/components/shared/one-time-code-input` must also import and render `<HydrationGate>`.
- Exemption grammar is unchanged: `// hydration-gate-ok: <reason>`, reason mandatory.
- Add cases to the existing `checkHydrationGate` unit test: a passing gated consumer, a failing ungated one, and an exempt one.
- The narrow trigger is deliberate. Making the gate a generic "every client form" rule is a separate decision and not this pipeline's.

**R6. Recovery mode swaps fields in and out of the page.**
- Digit mode and recovery mode render **mutually exclusive** fields named `token`. Exactly one `token` field exists in the page at any time; never hide one with CSS. `FormData.get("token")` returns the first match, so two fields would silently send the wrong one.
- `verifyTotpAction` is **unchanged**, as are its audit keys and its rate limit.
- The error prop passed to the client form is the allow-listed `"invalid" | "rate_limited" | undefined`, never the raw `sp.error`.
- Error text moves from `text-red-500` (a palette literal) to the token-based destructive colour, with `role="alert"`.

### Item 1: Google button

**R7. Where the Google literals live (DECISION-190).**
- Google's published values sit in **one typed constant in `google-sign-in-button.tsx`**:
  - light: fill `#FFFFFF`, stroke `#747775`, text `#1F1F1F`
  - dark: fill `#131314`, stroke `#8E918F`, text `#E3E3E3`
  - the four "G" mark fills, inside the official inline SVG, `aria-hidden`
- They are applied as **inline custom properties on the element** (`--gsi-*`), read by fixed arbitrary-value classes (`bg-[var(--gsi-fill)] dark:bg-[var(--gsi-fill-dark)]`, and so on).
- The `--gsi-*` properties are **never declared in `globals.css` and never added to `TOKEN_POLICY`**. They are Google's colours, not PresbyPortal design tokens, so `contract.test.ts`'s closure test is unaffected.
- The button renders the generated `<Button>` (shape, focus ring and disabled behaviour come from the primitive). Only colour comes from the constant.
- **No `google` variant on `button.tsx`.** A third party's brand does not belong in a generated primitive.
- Touch target: `min-h-[44px]`, as `ui-standards.md` already allows.
- **Recorded departure:** Google's guidelines require Google Sans Medium. We use the platform sans and load no font.
- `ui-standards.md` gets a short note under "Never write a Tailwind palette literal": "Sole exemption: the Google sign-in button's published colours, confined to `google-sign-in-button.tsx` (DECISION-190)." The Pre-merge checklist item gets the same parenthetical, so QA's literal check passes a correct implementation.

**R8. Keep `data-brand-neutral`; rewrite both comments.**
- The wrapper no longer protects the colours; inline properties already do. It still resets `--ring` to the platform value on a branded `/signin`, which keeps the focus ring's D4 contrast holding against the white or dark Google surface whatever the org's brand.
- Replace the "never recolored" wording in `page.tsx` (the header block and the inline JSX comment) with that rationale. `brand-tokens.tsx` is not touched.
- `check:brand-scope` is unaffected: no emitter, no `*-brand` utility, no `<style>`, and no button-shaped class string.

### Item 2: email layout

**R9. `renderEmail()` lives in `src/lib/email/render.ts` and is pure.**
- No `server-only`, no database, no `process.env`, no request headers.
- `src/lib/giving/statements/notice.ts` documents itself as "Pure: no database, no `server-only`", so it must keep compiling and testing in isolation. It imports from `@/lib/email/render` **directly, never through the `@/lib/email` barrel**, because the barrel pulls in the `server-only` `queue.ts`.
- The barrel may also re-export `renderEmail` for server callers.

**R10. Enforce at the type level, plus a small scan (DECISION-191). This changes Q5.**
- No automatic wrapping inside `enqueueEmail`. Phase 1's double-wrap concern stands.
- `EnqueueEmailInput` stops taking `subject`/`html`/`text` and takes `message: RenderedEmail` instead (alongside `to`, `templateKey`, `from?`, `replyTo?`, `maxAttempts?`).
- `RenderedEmail = { subject, html, text }` carries a `unique symbol` brand that only `render.ts` can produce.
- A source-scan unit test fails on any `as RenderedEmail` (including `as unknown as RenderedEmail`) outside `render.ts`.
- Why this instead of the call-site scan: a call-site scan can be satisfied by importing `renderEmail` and not using it, and cannot follow a value through a variable. The brand makes "every email has the layout and a plain-text part" a typecheck fact.
- **Content model:**
  - `renderEmail` takes structured content: subject, preheader, heading, paragraph blocks (multi-line user text has newlines turned into `<br>`), an optional single action `{ label, href }`, and a footer "why you got this" line.
  - **It escapes everything itself, and callers pass raw strings.** Callers that pass content to it stop calling `escapeHtml` on that content. Each migrated sender's test asserts that a `&` in the input appears escaped once in `html` and raw in `text`, which guards against double escaping during the migration.
  - `href` must parse as an absolute `http(s)` URL or `renderEmail` throws. That is a programming error; the existing send-time catch logs it.
  - The subject has CR/LF collapsed inside `renderEmail`. That fixes the class behind F162 in one place.
  - `text` is generated from the same structured content, never by stripping tags.
- All roughly 12 call sites, `queue.test.ts`, and the `statements.db.test.ts` stand-in convert **in one batch**. The type makes a partial conversion impossible.
- Delete the dead `sendPasswordResetEmail` and its barrel export.

**R11. Forward compatibility with DECISION-182, the sender registry.**
- `renderEmail` never chooses or names a sender, never reads `templateKey`, and builds no link from the request.
- The registry stays keyed on `templateKey` at `enqueueEmail`.
- Org-branded mail stays out of scope (Track F mail). The layout is platform-palette chrome for every class in v1.
- Fallback sender strings in `send.ts` and `.env.example` change from "presby" to "PresbyPortal". Confirming the production `RESEND_FROM_EMAIL` value is an operator action.

**R12. Repo tooling constrains the layout's markup (F160).** `check:brand-scope` scans every `.ts` file under `src/`, not just `.tsx`.
- **E3 forbids `<style` outside `src/components/brand/`.** Use **inline styles only**; Gmail strips `<style>` anyway. Declare the colour scheme with `<meta name="color-scheme">` and `<meta name="supported-color-schemes">`, not a stylesheet. No exemption is to be added.
- **C2 flags any `<table` literal.** Build every layout table through **one helper** whose single `<table` line carries `// ui-ok: HTML email layout string, not a React table`. Do not add a path exemption to the tripwire.

**R13. Giving notice (B5).**
- `notice.test.ts` keeps asserting on the **full rendered** `subject`/`html`/`text`. That is stronger than asserting on a fragment.
- `render.ts`'s fixed chrome must therefore contain no `$`, no `\d+\.\d{2}` (no `line-height:1.25`, no `0.85em`) and no `\d{1,3}(,\d{3})+`.
- A `render.test.ts` case renders empty content and asserts those three patterns are absent from the chrome.
- No year, and no digits other than CSS lengths, in the footer.
- The notice doc comment's "no digit but the tax year" becomes "no digit in the content but the tax year".
- The privacy sentence survives unchanged.

**Invitations adoption** (pipeline/invitations; not edited by this pipeline):
- Its email batch is not built yet. It plans `src/lib/onboarding/invitation-email.ts` under key `account_invitation`.
- Integration is serialised. **Whichever pipeline merges second adapts**, and the R10 brand makes that a compile error, so it cannot be missed.
  - If review-polish merges first, invitations rebases and renders through `renderEmail`.
  - If invitations merges first, review-polish's email batch converts `invitation-email.ts` with the other senders.
- Invitations' G5 (rewrite the link in the stored body after `sent`) must rewrite **both** `html` (the `href` and the printed URL) and `text`.
- So **`renderEmail` must emit the action URL as an unchanged substring** in each place: no soft-wrapping, no zero-width characters, no entity-encoding beyond the `&` → `&amp;` the `href` requires. A `replaceAll` on the escaped and raw forms then stays correct.
- Expect a small text conflict in `src/lib/email/queue.ts`, since both pipelines touch it.

### Item 4: organizations tree

**R14. Read strategy.**
- Keep the existing single `getPlatformDb()` select, adding `parentId` and `lifecycleStatus`.
- **Never read or parse `path`.** Never write `parent_id`/`path`. Never call an affiliation function.
- `org-tree.ts` holds pure functions with no database import:
  - **Tree building:** build the tree in memory from the flat rows. Roots are rows with null or unknown parents. Roots order by type rank, then name; siblings order by name, compared with NFC normalisation and case folding. Use a visited set so a cycle cannot recurse forever.
  - **Filtering:** keep the ancestors of every match, shown dimmed and not selectable.
  - **Display:** report per-node child counts, and apply the about-500-row display cap with an honest message (plus a TODO).
- Filters are GET params, parsed in `org-tree.ts`:
  - `type` and `status` (`platformStatus`) are allow-listed. Unknown values are ignored and never passed to a `pg` enum comparison.
  - `q` is trimmed, capped near 100 characters, and matched **in memory**, so there are no `LIKE` wildcard-escaping issues.
  - `?filter=unbranded` keeps working (the OQ4 report).
- No `<details>`; rows are always expanded (Q7).
- Use the `<Table>` primitive (C2).
- A non-`active` `lifecycleStatus` gets a badge using a `Badge` variant or token. Do not copy the page's existing `bg-green-500/15 text-green-700` literal into new code (F163).
- No row action other than the existing "Manage" link, and nothing chosen by tree position.

**R15. Error handling for the organizations read.**
- `(admin)` has no `error.tsx`. Do **not** add one for the whole admin area in this pipeline.
- Catch the read in the page and render an inline "unavailable, retry" state. Reuse `OrganizationsUnavailable` only if its copy fits an operator; otherwise write a short inline message.

### Auth-touching e2e (confirmed)

**R16. Required coverage.** `src/app/(auth)/` is touched by both `/signin` and `/totp`.
- **Phase 4 gate:** a running-server login smoke on dev port **3600** with the MFA-enrolled seeded user going through the new `/totp` must pass before Phase 5. QA's PASS requires it; a deferred run is BLOCKED.
- **Specs and helpers that change:**
  1. **New `e2e/support/totp-page.ts`** with `enterTotpCode(page, code)` (types into box 1 and relies on auto-advance) and `enterRecoveryCode(page, code)` (uses the toggle). Locate fields by the group's accessible name or by role, not by placeholder.
  2. **Replace all 10 `getByPlaceholder(/123456/)` call sites** with the helper: `e2e/totp-full-login.spec.ts` (2), `e2e/totp-callback-bypass.spec.ts` (5), `e2e/branded-signin.spec.ts` (1), `e2e/support/domains-ui-fixture.ts` (1), `e2e/support/giving-fixture.ts` (1).
  3. **New recovery-code e2e.** This is the lockout escape hatch, and it has no running-server coverage today (F164). `e2e/support/totp-fixture.ts` seeds a fresh recovery code each run for `mfa-enrolled`: the uppercase sha256, copied rather than imported, per the directory's no-app-import rule. The spec signs in through the toggle.
  4. **New `e2e/hydration/totp-challenge.spec.ts`**, run in both lanes per DECISION-159: hold the JavaScript chunks and assert the boxes and Verify are `toBeDisabled()`; release, wait for `toBeEnabled()`, and assert that box 1 has focus; complete sign-in, then assert that **no `TOTP_VERIFY_FAILED` audit row** was written. That audit row is the persisted state to check, not just the DOM.
  5. **A paste-a-full-code case** (dev lane) covering the split-into-boxes path.
- Email rendering is covered by unit tests. Gmail and Apple Mail dark-mode rendering is an eyeball check for Phase 6 or the operator (via `EMAIL_DEV_REDIRECT_TO`), not a QA gate.

## Suggestions

- **S1.** Add an assertion to `e2e/branded-signin.spec.ts`: under a branded `/signin`, the Google button's computed background is still the Google light fill. That proves the brand cascade cannot repaint it.
- **S2.** `OneTimeCodeInput` could use one visually hidden real input under six presentational boxes rather than six real inputs. That makes autofill and paste spreading trivial and gives screen readers a single field. Phase 3's call; R2 holds either way.
- **S3.** Batch order as Phase 1 proposed: Google button → `/totp` + enrolment → organizations tree → email. If the email batch slips, it slips whole (R10).
- **S4.** `/signin`'s `npm run db:seed` hint (Q11) stays an operator question. Don't fix it silently.

## Proposed decisions (reserved range)

- **DECISION-190:** The Google sign-in button is the only exemption from the palette-literal ban. Google's published fill, stroke, text and "G" colours live in one typed constant in `src/app/(auth)/signin/google-sign-in-button.tsx`. They are applied as element-scoped `--gsi-*` properties that are never declared in `globals.css` or `TOKEN_POLICY`. The button renders the generated `<Button>`, with no primitive variant. `data-brand-neutral` stays for the platform focus ring. Google Sans is not loaded (a recorded departure).
- **DECISION-191:** Every outbound email is a `RenderedEmail`, a branded `{ subject, html, text }` that only the pure `renderEmail()` in `src/lib/email/render.ts` can produce. `enqueueEmail` accepts nothing else, and a source scan bans casts to the brand. `renderEmail` escapes all content, validates the action `href`, strips CR/LF from the subject, generates the plain-text part from structured content, and uses inline styles and a single annotated table helper (no `<style>`). There is no automatic wrapping inside `enqueueEmail`, and no sender choice inside `renderEmail` (DECISION-182 stays keyed on `templateKey`).
- **DECISION-192 (amends DECISION-159):** A form whose submitted value depends on hydration is gated even without `useForm`. Every consumer of `src/components/shared/one-time-code-input.tsx` renders `<HydrationGate>`, enforced by new rule H3 in `check:hydration-gate`. The component focuses on mount only when asked, and only after hydration.
- DECISION-193: not used. Left for tech-lead.

## Proposed findings (reserved range)

- **F160:** `check:brand-scope` scans every `.ts`/`.tsx` under `src/`. C2's `<table` rule and E3's `<style` rule assume React markup, so any HTML-email string trips them. Resolved by R12 (one annotated table helper, inline styles only), not by changing the tripwire.
- **F161:** `email_change_verify` puts `newEmail` into HTML unescaped (`src/app/(account)/account/actions.ts`, the `<strong>${newEmail}</strong>` line). Today only the upstream email-format check mitigates it. Closed structurally by R10, since `renderEmail` escapes all content.
- **F162:** The ticket and feedback senders HTML-escape the **subject** (for example, `src/lib/tickets-notifications.ts:133,168,210,250,281`). Subjects are plain-text headers, so "Q&A" arrives as "Q&amp;A", while CR/LF is not stripped. Closed by R10, since `renderEmail` owns the subject.
- **F163:** The palette-literal ban in `ui-standards.md` is enforced only by review. Roughly 80 matches for the red, green, amber, blue and yellow families alone exist in `src/**/*.tsx`, including this pipeline's own surfaces (`/totp`'s `text-red-500`, the `/admin/organizations` Branded badge). This pipeline fixes `/totp` (R6) and adds no new ones (R14). The tree-wide sweep, or a tripwire, is a TODO line.
- **F164:** The `/totp` recovery-code path, the lockout escape hatch, has no running-server e2e coverage. Every existing spec types only a six-digit code. Closed by R16(3).
- F165: not used.

## Handoff

Next: **tech-lead (Phase 3).** Write the design doc against R1–R16, and name the implementer per batch. Likely ux-developer for the button, code entry and tree, and api-developer or full-stack-developer for the email batch, since it changes `queue.ts` and all about 12 senders. Inputs carried forward from Phase 1: gaps 5 and 13 (four states, accessibility), 15 (escaping and subjects; now F161/F162 under R10), 17 (B5; now R13), 8–9 (now R4, R5, R16), the MFA-enrolled smoke before Phase 5, and the organizations error state (R15). Orchestrator at integration: record DECISION-190/191/192 and F160–F164; update the `check:hydration-gate` line in `CLAUDE.md`; add TODO lines for the F163 sweep and the organizations row-cap follow-up; apply the invitations adoption order described under R13.


---

# Phase 3 — Technical Design (tech-lead)

*2026-10-21, tech-lead. Written against the live tree of `pipeline/review-polish` (main 86dd835). Binding inputs: Phase 1 Q1–Q11 (orchestrator's provisional defaults), Phase 2 R1–R16. Where this design adds a detail the architect left to Phase 3, it says so; nothing here contradicts a ruling.*

## Summary

Four independent polish items from the operator's production review, shipped as four batches on one branch, no schema, permission, flag or dependency change.

- **A — Google button.** `/signin`'s "Sign in with Google" becomes Google's own light/dark button (white or near-black surface, thin neutral border, four-colour "G"), colours confined to one typed constant (DECISION-190).
- **B — Per-digit code entry.** `/totp` and `/account/2fa` get one shared `OneTimeCodeInput` (six boxes, focus on box 1 after hydration, Backspace/Delete across boxes, paste and one-time-code autofill spread across boxes). `/totp` keeps a recovery-code escape hatch behind a visible toggle, is wrapped in `HydrationGate`, and the `check:hydration-gate` tripwire learns rule H3 (DECISION-192).
- **C — Organizations tree.** `/admin/organizations` renders the council tree from `parent_id` (synod → presbytery → congregation), filterable by name, type, `platformStatus` and the existing branded toggle through a plain GET form; matches keep their ancestors as dimmed context; a soft 500-row cap degrades honestly.
- **D — Rich email.** Every outbound message is a branded `RenderedEmail { subject, html, text }` that only the pure `renderEmail()` can produce; `enqueueEmail` accepts nothing else (DECISION-191). All 13 `enqueueEmail` call sites (12 template keys) convert in one batch. Structurally closes F161 (unescaped `newEmail`) and F162 (HTML-escaped subjects), and surfaces F165 (dead relative links in ticket and feedback mail).

The "test organization" flag stays out of scope (Kickoff).

## Permissions & Flags

- **Permission keys:** none new. `/admin/organizations` keeps `FEATURES.ADMIN_ORGANIZATIONS` with its inline denial; `/signin` and `/totp` stay permission-free.
- **Default role bindings:** none; no `FEATURE_CATALOG` or seed change.
- **Feature flags:** none (operator rule: no new platform flags before go-live). `ui.branded_signin` is untouched. Rollback of any batch is a plain revert; `email_queue` keeps already-rendered rows (no backfill).
- **Audit events:** none new. `/totp` keeps `TOTP_VERIFY_*` / `TOTP_RECOVERY_*` exactly as written today; the new e2e asserts on them. `npm run check:audit` is unaffected (no new `actions.ts` mutation).

## API Contract

No routes. `verifyTotpAction(formData: FormData)` is **unchanged** (R6); the new client form posts the same two fields (`token`, `callbackUrl`).

### B1. `OneTimeCodeInput` — `src/components/shared/one-time-code-input.tsx` (`'use client'`, UI only, R1)

```ts
export interface OneTimeCodeInputProps {
  /** `name` of the ONE hidden <input> carrying the joined value. The boxes carry no `name` (R2.1). */
  name: string;
  /** Visible label (a <Label htmlFor=box1 id=labelId>); also names the role="group" via aria-labelledby. */
  label: string;
  /** Controlled. Digits only, length <= `length`. A hole (cleared middle box) yields a value shorter than `length`. */
  value: string;
  onValueChange: (next: string) => void;
  length?: number;                      // default 6
  autoFocus?: boolean;                  // default false (R2.2); focuses box 1 AFTER hydration, via effect (R2.3)
  disabled?: boolean;
  invalid?: boolean;                    // aria-invalid on every box
  describedBy?: string;                 // id of the error/hint element -> aria-describedby on every box
  onComplete?: (code: string) => void;  // fires on a user edit that makes value reach `length` digits; never on mount
  id?: string;                          // base id; default useId()
  className?: string;
}
```

Decision (tech-lead, DECISION-193a, S2 resolved): **six real `<Input>` boxes**, not one hidden input under six presentational cells. Reasons: R3 requires the generated `<Input>` primitive (ring, offset, disabled and invalid states for free); per-box accessible names ("Digit 1 of 6") are what Phase 1 gap 13 specified; a hidden-input design needs caret mirroring and a bespoke focus ring, which is more code and more risk with no dependency to lean on. Cost: more key handling, listed below and covered by unit tests. The group itself is `<div role="group" aria-labelledby>`, **never** a `<fieldset>`/`<legend>` (HydrationGate forbids a legend).

Behaviour table (all pure client state; the server action stays the authority):

| Event | Behaviour |
|---|---|
| Render | `length` boxes, each `<Input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete={i===0 ? "one-time-code" : "off"} aria-label="Digit {i+1} of {length}" />`, no `maxLength` (autofill must be able to land more than one character), no `name`, `enterKeyHint` unset. One `<input type="hidden" name={name} value={value}>`. |
| Size | Each box `h-12 w-11 flex-none px-0 text-center`, font at the largest existing type-scale role that fits (implementer cites the role in a comment), `gap-2`. 6×44 + 5×8 = 304px, inside the 312px content width at 360px; survives 200% zoom by wrapping the row (`flex-wrap`) rather than shrinking boxes. All size classes live in this one component (R3); `ui/input.tsx` is not edited. |
| Focus on mount | `useEffect` keyed on `useHydrated()`; when `autoFocus && hydrated` and it has not run before, `boxes[0].focus()`. Never the `autoFocus` HTML attribute (R2.3). |
| Focus into a box | `select()` the content, so a typed digit replaces rather than appends. |
| Typed digit | Strip to ASCII digits after NFKC (full-width digits count). Exactly one digit: write box i, focus box i+1 (stay on the last). Non-digit: ignored, box content restored. |
| Overtype (box already held a digit and the event delivers two characters) | The newly typed digit wins: `raw.replace(previousDigit, "")[0]`. |
| Multi-character event (iOS one-time-code autofill, Android suggestion, paste) | Digits extracted as above. If `digits.length >= length`: take the first `length`, write from box 1. Otherwise write from the focused box, advancing. Focus lands on the first empty box, or on the last box when full. |
| `onPaste` | `preventDefault()`, then the same path as the multi-character event, with `clipboardData.getData("text")`. Spaces, hyphens, newlines are dropped. |
| Backspace / Delete | Filled box: clear it, stay. Empty box: move to the previous box and clear it. (Delete mirrors Backspace deliberately: the operator said "delete key should work across boxes", and no key may leave a stale digit behind.) |
| ArrowLeft / ArrowRight / Home / End | Move between boxes. |
| Completion | When an edit leaves `value.length === length`, call `onComplete(value)`. No auto-submit (Q3). |
| `disabled` | Every box `disabled`. Pre-hydration the surrounding `HydrationGate` already disables them. |

Emitted value is `slots.join("")` with empty slots dropped, so a hole makes the code short and Verify stays disabled; only six contiguous digits are submittable.

### B2. `TotpChallengeForm` — `src/app/(auth)/totp/totp-challenge-form.tsx` (`'use client'`)

```ts
interface TotpChallengeFormProps {
  callbackUrl: string;                     // already sanitised by page.tsx; echoed in a hidden field
  error?: "invalid" | "rate_limited";      // allow-listed by page.tsx; never the raw sp.error (R6)
}
```

`page.tsx` stays a Server Component (session, enrolment check, `sanitizeCallbackUrl`) and renders `<TotpChallengeForm callbackUrl error />` under the existing `<h1>Two-factor authentication</h1>`.

Structure: `<HydrationGate><form action={verifyTotpAction}>` (R4, wrapped from the outside) containing, in order: hidden `callbackUrl`; **either** `<OneTimeCodeInput name="token" label="6-digit code from your authenticator app" autoFocus … />` **or** a recovery `<Input name="token" label="Recovery code" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ABCD-EFGH" autoFocus />` (conditional rendering, never CSS-hidden: exactly one `token` field exists at any time, R6); an `id="totp-error"` message with `role="alert"` in `text-destructive` (replaces `text-red-500`, F163); a `VerifyButton`; a `<Button type="button" variant="link" className="min-h-11">` toggling "Use a recovery code instead" / "Use my authenticator app instead".

- `VerifyButton` is a small child component using `useFormStatus()`; `disabled` while pending (label "Verifying…") or while the field is incomplete (digit mode: `value.length !== 6`; recovery mode: trimmed value empty). It takes a ref so `onComplete` can move focus to it.
- Error copy is unchanged ("That code didn't match. Try again, or use a recovery code." / "Too many attempts. Please wait a moment before trying again."), one element only, so `getByText(/didn.t match/i)` stays unique. Authenticator and recovery failures show identical copy (no enumeration).
- A failed attempt is a full-page redirect, so the form remounts in digit mode with box 1 focused. A user who failed with a recovery code lands back in digit mode and must press the toggle again. Accepted residual (persisting the mode would need either the action to echo it or `sessionStorage` read after hydration; neither is worth it in v1). The error copy already names the recovery option.
- Enrolment (`totp-enroll-form.tsx`, edited in place): wrap the `<form>` in `HydrationGate` (R4); replace the single `<Input id="totp-enroll-code">` with `<OneTimeCodeInput name="code" label="Enter the 6-digit code from your app" value={code} onValueChange={setCode} disabled={pending} />`; `autoFocus` stays off (R2.2); `handleSubmit`, the toast and the `completeEnrollment` call are unchanged.

### B3. `check-hydration-gate` rule H3 (R5)

Any non-test `.tsx` file with a non-comment line importing `from "@/components/shared/one-time-code-input"` must also have the `HydrationGate` import and a `<HydrationGate` element (both non-comment lines). Exemption `// hydration-gate-ok: <reason>` on the import line or the line above, reason mandatory (same grammar). H3 reports at the importing line. Update the script's header comment; the CLAUDE.md Common Commands line is the orchestrator's integration edit. `check-hydration-gate.test.mjs` gains: gated consumer passes; ungated fails (H3); gate imported but not rendered fails; exempt with reason passes; exempt without reason fails; a test file consumer is ignored; the component's own file is not flagged.

### A. `GoogleSignInButton` — `src/app/(auth)/signin/google-sign-in-button.tsx` (Server Component)

```ts
export function GoogleSignInButton(): JSX.Element   // a type="submit" <Button> for use inside the existing server-action <form>
```

- One typed constant `GOOGLE_BUTTON` in the file holds the published values (R7): light fill `#FFFFFF` / stroke `#747775` / text `#1F1F1F`; dark fill `#131314` / stroke `#8E918F` / text `#E3E3E3`; the four mark fills `#EA4335 #4285F4 #FBBC05 #34A853`; plus **solid** hover and pressed fills and a disabled fill/stroke/text (pre-composited from Google's 8% / 12% state layers and 38% disabled alpha, so each is an opaque hex that `contrastRatio()` can read; contrast.ts rejects alpha). The constant's header cites the guideline page and the date the values were read; **the implementer re-reads Google's current branding guidelines when writing it and records any difference** (the values above are from the design author's knowledge, not a fetch).
- Applied as element-scoped custom properties through `style={{ "--gsi-fill": …, "--gsi-fill-dark": … }}` (typed cast) and read by arbitrary-value classes **with the type hint** (`bg-[color:var(--gsi-fill)] dark:bg-[color:var(--gsi-fill-dark)] border-[color:var(--gsi-stroke)] text-[color:var(--gsi-text)] hover:bg-[color:var(--gsi-hover)] active:bg-[color:var(--gsi-pressed)] disabled:…`). The `color:` hint is required so `tailwind-merge` in `cn()` recognises each as the same class group as the `<Button>`'s own `bg-/border-/text-` classes and replaces rather than coexists with them; the e2e computed-style assertion (S1) proves it took.
- Renders the generated `<Button variant="outline" type="submit" className="w-full min-h-[44px] gap-3 …">` (shape, focus ring with offset, disabled behaviour from the primitive); no `google` variant on `button.tsx`. Inline official "G" SVG, `aria-hidden`, label text unchanged: "Sign in with Google". All five states present: default, hover, active, disabled, focus-visible.
- The `--gsi-*` properties are never declared in `globals.css` and never added to `TOKEN_POLICY` (R7); `contract.test.ts` is unaffected.
- `page.tsx`: keep `<form action={…server action…} data-brand-neutral="">` and swap the `<Button>` for `<GoogleSignInButton />`; rewrite **both** "never recolored" comments (header block and JSX comment) to the R8 rationale (the wrapper no longer protects the colours; it resets `--ring` to the platform value so the focus ring's D4 contrast holds on the white/dark Google surface under any org brand).
- `docs/ui-standards.md`: one sentence under "Never write a Tailwind palette literal" and the same parenthetical on the Pre-merge checklist item: "Sole exemption: the Google sign-in button's published colours, confined to `google-sign-in-button.tsx` (DECISION-190)."
- Unit test `google-sign-in-button.test.tsx` (jsdom): renders a submit button named "Sign in with Google"; the SVG is `aria-hidden`; the style attribute carries each `--gsi-*` property; a contrast test over the constant using `contrastRatio` from `src/lib/brand/contrast.ts` (label on fill and on hover/pressed fill ≥ 7:1, stroke on fill ≥ 3:1, both schemes). Disabled colours are exempt from contrast (WCAG exempts disabled controls).

### D1. `renderEmail` — `src/lib/email/render.ts` (pure; no `server-only`, no db, no `process.env`, no headers; R9)

```ts
declare const renderedEmailBrand: unique symbol;

export type RenderedEmail = {
  readonly subject: string;   // raw text, CR/LF/runs of whitespace collapsed to one space, trimmed, capped
  readonly html: string;
  readonly text: string;
  readonly [renderedEmailBrand]: true;   // type-only; produced by `as RenderedEmail` inside render.ts ONLY
};

export type EmailBlock =
  | { kind: "p"; text: string }                                              // newlines -> <br>
  | { kind: "facts"; rows: ReadonlyArray<{ label: string; value: string }> } // "Label: value" lines, label in <strong>
  | { kind: "list"; label?: string; items: ReadonlyArray<string> }           // <ul>; text form "- item"
  | { kind: "quote"; text: string };                                         // user-supplied prose, pre-wrap, left rule

export interface EmailContent {
  subject: string;
  preheader?: string;                                   // hidden preview text; defaults to the heading
  heading: string;
  blocks: ReadonlyArray<EmailBlock>;
  action?: { label: string; href: string };             // single bulletproof button + the raw URL printed beneath
  footnote?: string;                                    // per-message "why you got this" / safety line
}

export function renderEmail(content: EmailContent): RenderedEmail;   // throws on a non-http(s) / non-absolute action.href
```

Rules (all binding; the unit tests in D4 assert each):

1. **Callers pass raw strings.** `renderEmail` escapes every interpolated value itself (heading, preheader, block text, labels, button label, footnote) and the `href` for attribute context. Callers stop calling `escapeHtml` on content. A `&` in input is `&amp;` once in `html` and `&` raw in `text` and in `subject`.
2. **`action.href`**: must be a string with no whitespace/control characters that `new URL()` parses with protocol `http:` or `https:`; otherwise `renderEmail` throws (a programmer error; the existing send-time catches log it). The output uses the caller's **original string**, not `URL.href`, so substring rewrites stay valid.
3. **Action URL substring invariant (R13/invitations G5):** the URL appears unchanged as `href="…"` (with `&`→`&amp;` only), as the printed visible link text (same escaping), and raw on its own line in `text`. No soft-wrapping, no zero-width characters, no further entity encoding. (CSS `word-break` is fine; it does not alter the substring.)
4. **Subject**: `subject.replace(/\s+/g, " ").trim()` capped at 200 characters. Never HTML-escaped. This closes F162 class-wide.
5. **Text part** is generated from the structured content (heading, blocks, action label + URL, footnote, footer), never by stripping HTML.
6. **Markup (R12, F160):** inline styles only; no `<style` anywhere; `<meta name="color-scheme" content="light">` and `<meta name="supported-color-schemes" content="light">` in `<head>` (we ship exactly one scheme, so we declare exactly one; Phase 1 suggested `light dark`, this is the honest value while no dark styles exist; revisit after the Gmail/Apple Mail eyeball check). Every table built by **one** helper whose single `<table` line has `// ui-ok: HTML email layout string, not a React table` on the line directly above. Every block carries explicit `bgcolor` and `color`. ~600px wide, `role="presentation"` tables, hidden preheader, text wordmark "PresbyPortal" (no `<img>`, no remote asset), bulletproof button (table cell + anchor), raw URL printed under the button.
7. **Palette:** hex constants in `render.ts`, transcribed from `PLATFORM_TOKENS` (brand kit navy `#0D2240`, blue `#1A5AA8`, white) with a test asserting each equals the corresponding token via `parseColor()` and every text/background pair clears 7:1 via `contrastRatio()`. Hex only, never `rgb(a,b,c)` (see rule 8).
8. **Giving-notice chrome constraints (R13):** the fixed chrome contains no `$`, no `\d+\.\d{2}` (so no decimal CSS values such as `line-height:1.5`), no `\d{1,3}(,\d{3})+` (so no `rgb(255,255,255)`), no year, and no digits except integer CSS lengths. It also contains none of the words the domain tests forbid in `subject + html + text`: `vercel`, `resend`, `cloudflare`, `presby-verify`, `bearer`, `authorization`, `token` (`notify.test.ts` lines 93 and 200; `service.db.test.ts` asserts the stored token never appears). Footer copy therefore stays generic ("This message was sent automatically by PresbyPortal."); the per-message `footnote` carries the situational line. No address, phone number, unsubscribe link or remote image (No Real Data; transactional mail).
9. **Subject/preheader/heading are not the same string by accident:** `preheader` defaults to `heading`; `heading` is the visible H1-equivalent inside the card.

Barrel (`src/lib/email/index.ts`): additionally re-exports `renderEmail` and the types for server callers that import the barrel, **but every sender imports from `@/lib/email/render` directly**. Reason (R9 plus a test fact found in this design): `notify.test.ts`, `service.db.test.ts`, `sweep.db.test.ts`, `feedback/actions.test.ts`, `tickets/actions.test.ts`, `statements.db.test.ts` and others replace the **whole barrel** with `vi.mock("@/lib/email", () => ({ enqueueEmail }))`; a sender importing `renderEmail` from the barrel would get `undefined` under those mocks.

### D2. `enqueueEmail` input (queue.ts)

```ts
export type EnqueueEmailInput = {
  to: string;
  message: RenderedEmail;      // replaces subject/html/text
  templateKey: string;
  from?: string;
  replyTo?: string;
  maxAttempts?: number;
};
```
`queue.ts` inserts `message.subject` / `message.html` / `message.text`. `send.ts`'s `SendEmailInput` (transport) is unchanged. Delete `sendPasswordResetEmail` and its barrel export (no callers: `grep -rn sendPasswordResetEmail src` returns only its own definition and the barrel). `send.ts` and `.env.example` fallback sender string "presby <noreply@example.com>" becomes "PresbyPortal <noreply@example.com>" (R11). **Production value:** `docs/deployment.md:225` already records `RESEND_FROM_EMAIL` as `PresbyPortal <noreply@presbyportal.org>` (set 2026-10-19); Q10 reduces to the operator re-reading the Vercel value once (checklist step 4).

### D3. Account-mail builders — `src/lib/email/account-messages.ts` (new, pure)

`'use server'` files may only export async functions, and the two account senders live in `actions.ts` files, so their message builders go in a flat file in the existing `src/lib/email/` directory (not a new subdirectory; no Phase 2 escalation needed):

```ts
export function buildPasswordResetEmail(input: { resetUrl: string }): RenderedEmail;
export function buildEmailChangeVerifyEmail(input: { newEmail: string; verifyUrl: string }): RenderedEmail;
```
Link construction in the two actions stays exactly as today (`NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"`); only the message changes.

### D4. Per-sender conversion table (every `enqueueEmail` caller, found by `grep -rn "enqueueEmail(" src`; 13 call sites, 12 template keys)

| # | `templateKey` | Call site | Builder after conversion | Content (all raw strings) | Existing bug closed or notes |
|---|---|---|---|---|---|
| 1 | `email_change_verify` | `src/app/(account)/account/actions.ts:147` | `buildEmailChangeVerifyEmail` | subject "Confirm your new email address"; p "You asked to change your sign-in email address to {newEmail}."; p "This link expires in 24 hours."; action "Confirm email change" → `verifyUrl`; footnote "If you did not request this change, you can safely ignore this email." | **F161**: `newEmail` was interpolated unescaped into `<strong>`; now escaped by `renderEmail`. Test: `<img src=x onerror=1>@example.invalid` as `newEmail` is escaped in `html` and raw in `text`. |
| 2 | `password_reset` | `src/app/(password-reset)/actions.ts:96` | `buildPasswordResetEmail` | subject "Reset your password"; p "Someone asked to reset the password for your account."; p "This link expires in 60 minutes."; action "Reset your password" → `resetUrl`; footnote "If you did not request this, you can safely ignore this email." | Must keep the forgot-password page's "expires in 60 minutes" truth. Printed URL stays visible (phishing look-alike mitigation). |
| 3 | `feedback_notification` | `src/app/(member)/feedback/actions.ts:189` (loop per admin) | module-local `buildFeedbackEmail(...)` returning `RenderedEmail` (replaces `buildFeedbackEmailHtml`) | subject `New feedback — {category}` (raw; was `escapeHtml`d); facts From `{name} <{email}>`, Category, Page (if any), App version (if any); quote = the message; action "View all feedback" → `{platformOrigin()}/admin/feedback` | **F162** (escaped subject) and **F165** (the link was the relative `/admin/feedback`, dead in a mail client). No plain-text part existed; now generated. If `platformOrigin()` is `null` the action is omitted (mirrors `domains/notify.ts`). |
| 4 | `ticket_filed_confirmation` | `src/app/(org)/o/[slug]/tickets/actions.ts:164` | module-local `buildTicketFiledEmail(...)` | subject `Ticket filed: {subject}` (raw); p `Your ticket "{subject}" has been filed for {organizationName}. We'll follow up soon.`; action "View your tickets" → `{origin}/o/{slug}/tickets` (new; best-effort) | **F162**. Caller test asserts `message` shape; the existing `objectContaining({ to, templateKey })` assertion still holds. |
| 5 | `ticket_new` | `src/lib/tickets-notifications.ts:131` (loop per operator) | `notifyOperatorsOfNewTicket` builds via a shared local `ticketMessage(...)` | subject `New ticket: {subject}`; facts Organization, Subject, Category, Area, Priority, Submitted by; action "View this ticket" → `{origin}/admin/tickets/{id}` | **F162**, **F165**. |
| 6 | `ticket_operator_reply` | `tickets-notifications.ts:166` | same helper | subject `New reply on your ticket: {subject}`; p `{operator} replied to your ticket "{subject}".`; quote = excerpt; action "View the full thread" → `{origin}/o/{slug}/tickets/{id}` | **F162**, **F165**. |
| 7 | `ticket_submitter_reply` | `tickets-notifications.ts:208` (loop) | same helper | subject `New reply on ticket: {subject}`; p `{submitter} replied to their ticket "{subject}".`; quote = excerpt; action "View this ticket" → `{origin}/admin/tickets/{id}` | **F162**, **F165**. |
| 8 | `ticket_resolved` | `tickets-notifications.ts:248` | same helper | subject `Your ticket has been {status}: {subject}`; p `Your ticket "{subject}" has been marked {status}.`; action "View the full thread" | **F162**, **F165**. |
| 9 | `ticket_feedback_promoted` | `tickets-notifications.ts:279` | same helper | subject `Your feedback became a ticket: {subject}`; p `Hi {name}, your feedback has been turned into a ticket so we can track it: "{subject}".`; action "View the ticket" | **F162**, **F165**. |
| 10 | `statistics_submission_grant` | `src/lib/statistics-grants.ts:319` | module-local `buildStatisticsGrantEmail(...)` | subject `File {congregation}'s {year} statistical report` (raw); p `Hi {recipient},`; p `{congregation} has been asked to file its {year} annual statistical report.`; p "This link expires on {date} and can be used once."; action "Open the report form" → `submitUrl`; footnote "If you were not expecting this, you can safely ignore this email." | Date label replaces `toDateString()` (server-timezone, unlabeled) with a fixed `Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" })` plus "(UTC)", used identically in `html` and `text` (the text part used to carry the ISO string). Link construction unchanged. Drops the barrel `escapeHtml` import. |
| 11 | `domain_notification` | `src/lib/domains/notify.ts:270` (`sendDomainNotification`) | `buildDomainNotification` returns `RenderedEmail` | p `copy.line`; facts Organization, Made by; list "Domain(s):" of hostnames; action "Review it here" → `{platformOrigin()}/o/{slug}/admin/domains` (omitted when no link); footnote "If you did not expect this, contact PresbyPortal support." | Every phrase asserted by `notify.test.ts` is preserved (copy lines, `ACTOR_COPY`, org name, hostnames; `<img`/`<script>` escaped). ACCOUNT-class: still no `from`/`replyTo` (asserted today). |
| 12 | `domain_notification` | `notify.ts:396` (`sendOperatorAlert`) | `buildOperatorAlert` returns `RenderedEmail` | p `copy.line`; facts Organization; list "Domain(s):"; action "Open platform admin" → `{origin}/admin/organizations` | Same constraints. |
| 13 | `giving.statement.notice` | `src/lib/giving/statements.ts:1038` (inside the issue transaction) | `buildStatementNotice` returns `{ templateKey, message: RenderedEmail }` (shape change: `message` replaces flat `subject/html/text`) | heading, intro (issued / corrected), p "Sign in to view and download it.", action "View my statement" → `link`, privacy paragraph verbatim ("For your privacy this message does not list any gifts. …") | B5 (R13): `notice.test.ts` keeps asserting the **full rendered** subject/html/text; header comment edited ("no digit in the content but the tax year"); imports `@/lib/email/render` directly; `check:giving-boundaries` B5 stays green (the file names the template key and has no money token). Caller passes `message: notice.message`. |

Non-sender files that change with the type: `src/lib/email/queue.ts` (+ `queue.test.ts`, which builds messages through `renderEmail`), `src/lib/email/send.ts`, `src/lib/email/index.ts`, `.env.example`, `src/lib/giving/statements.db.test.ts` (the `vi.mock("@/lib/email")` stand-in now takes `{ to, message, templateKey }` and inserts `message.*`), `src/lib/domains/notify.test.ts`, `service.db.test.ts` (~line 380: `c.subject/html/text` become `c.message.subject/html/text`), `sweep.db.test.ts` (~line 282: the `emails()` helper), the feedback and tickets `actions.test.ts` mocks. `npm run typecheck` lists every one; the brand makes a missed site a compile error.

### D5. Guard tests

- **Brand scan** (in `render.test.ts`, precedent `host.test.ts`'s source scan): fail on `as RenderedEmail`, `as unknown as RenderedEmail`, or `<RenderedEmail>` anywhere under `src/` outside `src/lib/email/render.ts` (comment lines skipped).
- **Chrome patterns** (R13): `renderEmail` of empty content asserts the three money patterns, `$`, the forbidden-word list (rule 8) and `<img`/`<style` are absent.
- **Source-scan caution for authors:** `check:brand-scope` scans test files too. Write `/<\s*style/` and `/<\s*table/` in assertions, never the literal `"<style"` / `"<table"`.

### C. `org-tree.ts` — `src/app/(admin)/admin/organizations/org-tree.ts` (pure, no db import; R14)

```ts
export type OrgTypeKey = "general_assembly" | "synod" | "presbytery" | "congregation" | "new_worshiping_community";
export type PlatformStatusKey = "managed" | "unmanaged" | "invited";

export interface OrgNode {
  id: string; name: string; organizationType: string;
  platformStatus: string; lifecycleStatus: string;
  parentId: string | null; hasBrand: boolean; brandUpdatedAt: Date | null;
}
export interface OrgFilters { q: string; type: OrgTypeKey | null; status: PlatformStatusKey | null; unbranded: boolean }

export function parseOrgFilters(sp: Record<string, string | string[] | undefined>): OrgFilters;
export function orgFiltersToQuery(f: OrgFilters): string;           // "" or "?filter=unbranded&q=…&type=…&status=…" (filter FIRST)
export interface TreeRow { org: OrgNode; depth: number; isMatch: boolean; childSummary: string | null }
export function buildOrgTree(
  rows: ReadonlyArray<OrgNode>, filters: OrgFilters, opts?: { cap?: number }   // cap default 500
): { rows: TreeRow[]; matchCount: number; totalCount: number; unbrandedCount: number; truncated: boolean };
```

- **Parse:** first value of an array param; `type`/`status` allow-listed (unknown ignored, never reaches SQL); `q` NFC-normalised, trimmed, capped at 100 characters; `filter` is `unbranded` or ignored. In-memory case-folded `includes` match (NFC + `toLocaleLowerCase("en")`), so no `LIKE` escaping exists.
- **Build:** group by `parentId`; roots are rows with null or **unknown** parent; roots ordered by type rank (general_assembly, synod, presbytery, congregation, new_worshiping_community) then name; siblings by name (same NFC/case-fold comparison); DFS with a **visited set**; any row never visited afterwards (cycle remnant) is appended as an extra root so a bad cache cannot silently hide a row. Never reads or parses `path`; never writes anything.
- **Filter:** a row is a match when it satisfies q, type, status and unbranded together; every ancestor of a match is included with `isMatch: false` (dimmed, no Manage link). `matchCount` counts matches only. No filters → every row matches.
- **Child summary:** from the **unfiltered** tree, direct children by type, e.g. "12 congregations" or "2 presbyteries, 1 congregation"; null for leaves.
- **Cap:** after ordering, rows beyond `cap` are dropped and `truncated: true`; the page says "Showing the first 500 of {matchCount} matching organizations. Narrow the list with the filters." (TODO line for real pagination, orchestrator at integration).
- **Page (`page.tsx`, edited in place, Server Component, no client code):** keeps the `hasFeature(…ADMIN_ORGANIZATIONS)` inline denial; wraps the single `getPlatformDb()` select (existing LEFT JOIN, adding `parentId` and `lifecycleStatus`) in try/catch and renders an inline "We couldn't load the organization list" panel with the `<h1>Organizations</h1>`, a `role="alert"` message and a "Try again" link to the same filtered URL (R15; `OrganizationsUnavailable`'s "your congregations" copy does not fit an operator; no `error.tsx` added). Filter UI is `<form method="get" action="/admin/organizations" role="search" aria-label="Filter the organization list">` (no new heading: existing e2e matches `getByRole("heading", { name: "Organizations" })` by substring): `q` text `<Input>` with a visible `<Label>`; type and status native `<select>`s in the ui-standards recipe (`appearance-none`, chevron, `text-base`, labelled); hidden `filter=unbranded` when on; "Apply" `<Button type="submit">`; "Clear filters" link when any filter is active. The existing **All (n)** and **Still on default palette (n)** link-buttons stay as links (not a checkbox) and carry the other active params through `orgFiltersToQuery`, with `filter` first so `?filter=unbranded` still matches `/admin/organizations?filter=unbranded` in the existing spec.
- **Table (`<Table>` primitive, C2):** columns Organization (indented name, `sr-only` "Level N" prefix, child summary, and the type on mobile), Type (`hidden sm:table-cell`), Platform status (`hidden sm:table-cell`), Branding, Last updated (`hidden md:table-cell`), Manage. Indent is a **static** class map by depth capped at 4 (`pl-0 pl-4 pl-8 pl-12 pl-16` literals so Tailwind sees them) plus a left-border guide; always expanded, no `<details>` (Q7, iOS note). Rows carry `data-depth` and `data-match` for e2e. Non-`active` `lifecycleStatus` renders a `<Badge>` (`destructive` for dissolved/dismissed, `secondary` for merged/divided) with the status word, so a dissolved congregation never looks live. The Branded/Default-palette badges lose the `bg-green-500/15 text-green-700` literal (F163): `outline` for Branded, `secondary` for Default palette. Empty states: no organizations ("No organizations yet." plus the New organization button), filters match nothing ("Nothing matches these filters." plus Clear filters), `?filter=unbranded` and nothing unbranded ("Every organization has a brand set." kept). No row action other than the existing Manage link, and nothing chosen by tree position (R14).

## Data Model

No schema changes required. No migration (`0060` stays unclaimed). No RLS, grant or function change. `organizations.parent_id` is read only; the cache is trigger-maintained and never written from this page (Phase 2 verified `organizations_guard_reparent` and `organization_affiliations_apply` on the pipeline branch).

## Component / Page Plan

**Create**
- `src/app/(auth)/signin/google-sign-in-button.tsx`, `google-sign-in-button.test.tsx`
- `src/components/shared/one-time-code-input.tsx`, `one-time-code-input.test.tsx`
- `src/app/(auth)/totp/totp-challenge-form.tsx`, `totp-challenge-form.test.tsx`
- `src/app/(admin)/admin/organizations/org-tree.ts`, `org-tree.test.ts`
- `src/lib/email/render.ts`, `render.test.ts`; `src/lib/email/account-messages.ts`, `account-messages.test.ts`
- `src/lib/tickets-notifications.test.ts` (new; none exists)
- `e2e/support/totp-page.ts`; `e2e/totp-code-entry.spec.ts`; `e2e/totp-recovery-code.spec.ts`; `e2e/hydration/totp-challenge.spec.ts`

**Modify**
- A: `src/app/(auth)/signin/page.tsx` (button swap, comments), `docs/ui-standards.md` (two parentheticals), `e2e/branded-signin.spec.ts`.
- B: `src/app/(auth)/totp/page.tsx`, `src/app/(account)/account/2fa/totp-enroll-form.tsx`, `scripts/check-hydration-gate.mjs` + `.test.mjs`, `e2e/support/totp-fixture.ts`, the 10 `getByPlaceholder(/123456/)` sites, `e2e/account-page.spec.ts`, `docs/ui-standards.md` (a short "one-time code entry" paragraph in the forms section), `docs/testing.md` (the helper and the new hydration spec).
- C: `src/app/(admin)/admin/organizations/page.tsx`, `e2e/admin-organizations.spec.ts`.
- D: `src/lib/email/queue.ts`, `queue.test.ts`, `send.ts`, `index.ts`; `.env.example`; the 13 call-site files in D4 and their tests; `src/lib/giving/statements/notice.ts` and `notice.test.ts`.

**Not modified:** `src/proxy.ts`, `src/lib/auth/*`, `src/auth.ts`, `verifyTotpAction`, `src/components/ui/*`, `brand-tokens.tsx`, `globals.css`, `src/lib/brand/contract.ts`, schema/migrations, `src/lib/permissions.ts`.

## Implementation Order

Four batches, one commit each (A, B, C, D; each a `feat(...)` commit carrying `Work-Log: 2026-10-21-review-polish`). Sequential in one worktree: A then B share `branded-signin.spec.ts` (A adds an assertion, B swaps one line). D can be dropped from the release whole if it slips (R10: the type makes a partial conversion impossible, so it ships entirely or not at all).

| Batch | Scope | Implementer | Why |
|---|---|---|---|
| **A** | Google button (component, page swap, comments, ui-standards note, S1 e2e assertion in `branded-signin.spec.ts`: computed background is still the Google light fill under a branded `/signin`, and the dark fill under `colorScheme: "dark"`) | **ux-developer** | Server component and styling only. |
| **B** | `OneTimeCodeInput`, `TotpChallengeForm`, page edit, enrolment form edit, H3 tripwire (+ fixtures), `e2e/support/totp-page.ts` and the 10-site swap, recovery fixture and spec, code-entry spec, hydration spec, `account-page.spec` addition | **full-stack-developer** | Client components plus a Node tripwire plus e2e/fixture DB seeding; one coupled auth-touching change, small enough that splitting adds hand-off cost. |
| **C** | `org-tree.ts`, page rewrite, e2e additions | **ux-developer** | A server-rendered admin page and a pure helper; no server action. |
| **D** | `render.ts`, queue type change, `account-messages.ts`, 13 senders, notice, deletions, guard tests, `.env.example`, docs sweep (`grep -rn "enqueueEmail" docs .claude` hits only `docs/decisions.md` history and an old review; no edit needed) | **api-developer** | Server logic across `queue.ts` and every sender; mostly tests of pure functions. |

Within D: (1) `render.ts` + `render.test.ts` (chrome, escaping, href, subject, text, brand scan); (2) `queue.ts` type + `queue.test.ts`; (3) `account-messages.ts` + the two account senders; (4) feedback, tickets (shared helper + `tickets-notifications.test.ts`), statistics grants; (5) domains notify + its three test files; (6) giving notice + statements stand-in; (7) delete `sendPasswordResetEmail`; sender-name strings; `npm run check` + `npm run typecheck` + the unit suite.

Gates for every batch: typecheck, `npm run check` (all eight tripwires), unit suite (serial for DB-backed tests per `docs/testing.md`), no `console.log`, no native dialogs, a 360px browser pass for A, B and C (CLAUDE.md Verify in a Browser), and `docs/TODO.md` left to the orchestrator at integration (Rule 16).

### Test and e2e plan (R16)

**Environment.** Dev server for this worktree on **port 3600**: `RATE_LIMIT_DISABLED=true` plus the `DOMAINS_*`/`CRON_SECRET` fakes `playwright.config.ts` sets for a server it starts (docs/testing.md "The server must have the test fakes"), started as `npx dotenv -e .env.local -- next dev -p 3600`, and `E2E_BASE_URL=http://localhost:3600 npx playwright test …`. Production-build lane: `PW_PROD_PORT=3900 npm run test:e2e:prod`, from a **scratch copy outside `~/git/presby-platform/`** with a hardlinked `node_modules` (the documented worktree turbopack-root workaround), with the **negative control**: in the copy, remove `<HydrationGate>` from `totp-challenge-form.tsx`, expect `e2e/hydration/totp-challenge.spec.ts` red at the pre-release `toBeDisabled()`, restore, expect green. `PW_PROD_PORT` 3900 and dev 3600 keep clear of 3000 (other checkouts), 3800 (default prod lane) and the invitations pipeline.

**MFA-enrolled smoke gate (Phase 4 gate, blocks Phase 5).** Before B's handoff: `e2e/totp-full-login.spec.ts` (credentials → `/totp` → wrong code rejected → real code signs in, via the new helper) passes on the 3600 dev server with the seeded `mfa-enrolled` user, and the new `totp-recovery-code.spec.ts` and `hydration/totp-challenge.spec.ts` pass in the dev lane. A skipped or deferred run is BLOCKED, not PASS.

**Existing e2e blast radius (specs whose assertions this change alters):**

| Spec | Why it breaks | Fix |
|---|---|---|
| `e2e/totp-full-login.spec.ts` (2 sites), `e2e/totp-callback-bypass.spec.ts` (5), `e2e/branded-signin.spec.ts:315`, `e2e/support/domains-ui-fixture.ts:209`, `e2e/support/giving-fixture.ts:616` | `getByPlaceholder(/123456/)` no longer exists | All ten call `enterTotpCode(page, code)` from `e2e/support/totp-page.ts` (locate by `getByRole("group", { name: /6-digit code/i })` and `getByLabel(/digit 1 of 6/i)`, wait for box 1 `toBeEnabled()`, then `pressSequentially(code)` relying on auto-advance). The `…/giving-fixture` and `domains-ui-fixture` helpers are used by many specs, so the helper must be robust to the pre-hydration disabled window. |
| `e2e/totp-full-login.spec.ts:44-47` | asserts `error=invalid` URL and `getByText(/didn.t match/i)` | Copy and URL unchanged; the message must remain a single element. Wrong-code entry uses the helper with `"000000"`. |
| `e2e/admin-organizations.spec.ts` ("Still on default palette", `getByText(ALPHA_ORG_NAME)`, `getByRole("heading", { name: "Organizations" })`, nav link) | The page structure changes | Keep: the link text and the `?filter=unbranded` href with `filter` first; the org name rendered exactly once; exactly one heading whose name contains "Organizations" (no new `<h2>` containing it, no `sr-only` text repeating a parent's name). New cases below. |
| `e2e/giving-statements.spec.ts:281-290` | Asserts the stored notice row's subject (exact), `$`-free and `\d+\.\d{2}`-free `html_body`/`text_body`, and `/o/{slug}/giving` in `text_body` | Must stay green unchanged; it is the real-row proof of R13 (chrome constraints). QA runs it in the post-D regression. |
| `e2e/forgot-password.spec.ts`, `e2e/feedback.spec.ts`, `e2e/account-page.spec.ts` (email change) | Trigger senders but read page text, not mail | Expected unaffected; confirm green. `e2e/admin-email-queue.spec.ts` only reads `templateKey`/status (no `htmlBody` on that page). |

**New e2e.**
- `e2e/totp-code-entry.spec.ts` (dev lane, `mfa-enrolled`, credentials sign-in first each test): box 1 is focused on render once hydrated; typing six digits advances box to box, enables Verify and moves focus to it (no auto-submit: URL still `/totp`); Backspace then Delete across boxes erase and move as specified; **paste of a full code** distributes (R16.5; grant `clipboard-read`/`clipboard-write` or dispatch a synthetic `paste` event with `DataTransfer`); the toggle swaps fields so `[name="token"]` count is exactly 1 in each mode (R6); at a 360×740 viewport all six boxes are inside the viewport and each is ≥44px wide; no `?error` carries a code in the URL.
- `e2e/totp-recovery-code.spec.ts` (R16.3, F164): `totp-fixture.ts` gains `seedRecoveryCode(sql, userId)` (deletes the user's recovery rows, inserts one unused code with the uppercase sha256 hex, algorithm **copied** not imported per the directory rule) called from `seedTotpEnrollment` and from the spec's `beforeEach` (the code is single-use). The spec signs in, presses the toggle by keyboard (Tab then Enter), enters a wrong recovery code → generic error and one `totp.recovery_failed` audit row, then the right one → `/admin`, one `totp.recovery_succeeded` row, and a second use of the same code fails.
- `e2e/hydration/totp-challenge.spec.ts` (R16.4; runs in **both** lanes): hold `/_next/static/**.js` on a second page of a context already past credentials; assert the group's boxes, the toggle and Verify are `toBeDisabled()` and the fieldset has `aria-busy`; release; `toBeEnabled()`; box 1 has focus; enter the real code and verify; then assert via `platformSql` that **no `totp.verify_failed` audit row** exists for the user since the test started (the persisted state, not just the DOM).
- `e2e/branded-signin.spec.ts` (S1): under a branded `/signin` the Google button's computed `background-color` is still `rgb(255, 255, 255)`; with `colorScheme: "dark"` it is the dark fill; the button box is ≥44px tall.
- `e2e/account-page.spec.ts`: on `/account/2fa` the code group renders six labelled boxes, enabled after hydration, no box focused on load (R2.2).
- `e2e/admin-organizations.spec.ts` (new cases, against the e2e fixture tree: Presbytery of the Eastern Fells with Wrenfield, Thistledown and Halloway): the presbytery row precedes its congregation rows and the congregations have a greater `data-depth`; `?q=wrenfield` shows Wrenfield as `data-match="true"` and the presbytery as `data-match="false"` with no Manage link on the dimmed row; `?type=congregation` likewise; `?type=bogus&status=nonsense` returns 200 and shows the unfiltered tree (allow-list); the GET form round-trips (type in the box, Apply, URL carries `q`); "Clear filters" returns to the bare URL; at 360px the Organization column and Manage remain visible and the page does not overflow horizontally.
- Email: unit tests only (no running-server mail inspection exists in the suite). Gmail and Apple Mail dark-mode rendering is an eyeball check via `EMAIL_DEV_REDIRECT_TO` (operator checklist step 3), not a QA gate (R16).

**Unit tests the implementers write (QA verifies they exist and run).**
- A: `google-sign-in-button.test.tsx` (above).
- B: `one-time-code-input.test.tsx` (jsdom, `fireEvent`; no user-event dependency in the repo): renders N labelled boxes and one hidden input named `name`, boxes have no `name`; focus-on-mount only when `autoFocus` and hydrated (mock `useHydrated`, pattern in `copy-month-button.test.tsx`); typing, overtype, non-digit rejection, full-width digits, multi-character event and paste (with spaces/hyphens/newline, and longer than `length`), Backspace/Delete on filled/empty/first box, arrows, `onComplete` fires once and not on mount, `disabled`. `totp-challenge-form.test.tsx`: exactly one `token` field per mode, toggle both ways, Verify disabled until complete / non-empty and while pending, error copy and `role="alert"`, `rate_limited` copy. `check-hydration-gate.test.mjs` H3 cases.
- C: `org-tree.test.ts`: roots/siblings ordering, unknown parent becomes a root, cycle (A→B→A and self-parent) terminates and keeps every row, filters (allow-list, `%`/`_` in `q` are literal, NFC/case-fold, 100-char cap, array params), ancestors kept dimmed, `unbranded` interplay, child summaries from the unfiltered tree, cap/truncation, query round-trip with `filter` first.
- D: `render.test.ts` (escaping once in html and raw in text and subject; CR/LF and 200-char cap; href accept/reject including `javascript:`, relative, spaces; URL substring invariant in href, printed link and text, including a URL with `&`; text generated not stripped; no `<style`, no `<img`, exactly the annotated table helper; palette equals tokens and clears 7:1; chrome money/forbidden-word patterns; brand scan); `account-messages.test.ts`; per-sender assertions (rows 1 to 13: raw `&` in subject, `&amp;` once in html, absolute link or omitted when `platformOrigin()` is null, plain-text part present); updated `queue.test.ts`, `notice.test.ts`, `notify.test.ts`, the db-backed domain and giving tests.

## Edge Cases & Risks

1. **Hydration vs focus (B).** `HydrationGate` is a disabled fieldset until hydration; the component focuses box 1 in an effect keyed on `useHydrated()`, which runs after the commit that removes `disabled`. Verified by the hydration spec in both lanes; the negative control proves the gate matters. The hidden `token` input is also inside the disabled fieldset, so a pre-hydration native submit posts no `token` and cannot burn a rate-limit slot.
2. **Two `token` fields (B).** Conditional rendering only; asserted by a unit and an e2e test. `FormData.get("token")` returns the first match, so a hidden duplicate would silently send the wrong value.
3. **Recovery mode lost on a failed attempt (B).** Accepted residual (above).
4. **iOS one-time-code autofill into box 1 (B).** Relies on no `maxLength` and the multi-character spread. If a hand-built component cannot satisfy iOS autofill or paste on a real phone, the work returns to Phase 2 for a dependency addendum (R-placement); nothing is installed ad hoc.
5. **Tailwind-merge and arbitrary values (A).** `bg-[var(--x)]` alone is ambiguous to `twMerge`; the `color:` hint is required, and S1 proves the Google fill wins over the primitive's own background in both schemes.
6. **Google disabled/hover states (A).** The primitive's `disabled:bg-muted` and `outline` hover/dark classes must be overridden class-for-class; the computed-style e2e covers light and dark default only, so hover and pressed are checked by eye in the 360px browser pass and recorded.
7. **Relative links in ticket and feedback mail were dead (F165, D).** The layout requires an absolute `href`, so these links become correct as a side effect. `platformOrigin()` returning `null` (production without an https `NEXT_PUBLIC_APP_URL`) omits the button rather than throwing, the same choice `domains/notify.ts` already makes. The three token-bearing senders keep their existing `NEXT_PUBLIC_APP_URL ?? localhost` construction (changing it is out of scope and a link-less reset email is worse than a localhost one in dev).
8. **A thrown `renderEmail` (D).** It throws only on a programmer error (bad `href`). Every caller already wraps the send in try/catch and logs without the message body (`tickets-notifications`, `notify`, feedback) or lets the action fail loudly (`password_reset`, `email_change_verify`). For those two a malformed `NEXT_PUBLIC_APP_URL` now fails loudly instead of sending a broken link; production builds already assert a valid https value at build time (`assertPlatformHostConfig`), so this only bites a misconfigured preview.
9. **Giving notice (D).** Chrome constraints are enforced by `render.test.ts` and re-proved on a real stored row by `giving-statements.spec.ts`. The year digit in the content is allowed; nothing else numeric appears in chrome beyond integer CSS lengths.
10. **Merge order with invitations (D).** Not edited here. `account_invitation` (`src/lib/onboarding/invitation-email.ts`) adopts `renderEmail` at whichever integration lands second; the brand makes it a compile error. Its G5 link rewrite must rewrite `html` (href and printed URL) and `text`; rule 3 guarantees the URL is an unchanged substring in all three places. Expect a small text conflict in `src/lib/email/queue.ts`. If review-polish lands first the invitations pipeline rebases; if second, batch D converts `invitation-email.ts` with the other senders (a 14th call site, found by the same grep).
11. **One-commit-one-prefix (D).** F161 and F162 are real defects, but they are fixed by the same change that introduces the type, and no stand-alone fix commit exists to carve out (a throwaway escape of `newEmail` would be deleted by the same batch). D lands as one `feat(email)` commit whose body names F161/F162/F165; no `fix:` trailers are owed because no `fix:` commit is made. Orchestrator may rule otherwise.
12. **`check:brand-scope` over email strings (F160).** Handled by R12 as designed; the implementer must not add a path exemption to the tripwire. A test file containing the literal `<style` or `<table` trips it (see D5).
13. **Org tree at scale (C).** Unbounded single query today, fine for current production; the 500-row cap and honest message mean it degrades visibly. TODO line (orchestrator): real pagination once presbyteries load their rolls.
14. **Org tree trust (C).** Display only. No link, action or authority is derived from tree position; no `path` read; no call to an affiliation function (R14, Two Hierarchies Intersect Nowhere).
15. **Palette literals (F163).** This pipeline removes `text-red-500` (`/totp`) and the Branded badge literal and adds none; the tree-wide sweep stays a TODO.
16. **Dark-mode mail.** One declared scheme (`light`); Gmail and Outlook may still force-invert. Explicit `bgcolor`/`color` on every block keeps contrast legible when inverted. Checked by eye only.

## Operator rulings needed

None block Phase 4. Informational or confirming:
- **Q10:** `docs/deployment.md` already records production `RESEND_FROM_EMAIL` as `PresbyPortal <noreply@presbyportal.org>`; please re-read the Vercel value once (checklist step 4). Code strings change to "PresbyPortal".
- **Q11 (unchanged):** the `/signin` "First time? Run `npm run db:seed` …" developer hint is **not** touched; still the operator's call.
- **Q1:** "pops" is interpreted as the official coloured "G" on a white (or near-black in dark mode) button. If the operator wants a saturated blue-filled button instead, say so before Batch A; it departs from Google's current guidance.
- **Confirm (behaviour change):** ticket and feedback notification emails now carry working absolute links (F165); previously the links were relative and dead.

## Proposed record entries (for the orchestrator to land at integration; Rule 16 keeps `docs/decisions.md` out of this pipeline's hands)

- **DECISION-193 (tech-lead, implementation):** (a) `OneTimeCodeInput` is six real `<Input>` boxes plus one hidden `name`d input, not a single hidden input under presentational cells (DECISION-192 holds either way); Backspace and Delete both erase backward; no auto-submit; completion calls `onComplete` only. (b) `renderEmail` takes a closed block vocabulary (`p`, `facts`, `list`, `quote`) plus one optional action and a footnote, escapes everything, and declares `color-scheme: light` while only one scheme ships. (c) Message builders for the two `'use server'` account senders live in `src/lib/email/account-messages.ts`; every sender imports `@/lib/email/render` directly, never through the mocked barrel. (d) Ticket and feedback mail links are built from `platformOrigin()` and omitted when it is `null`. (e) The organizations tree is always expanded, rows carry `data-depth`/`data-match`, the 500-row cap is a display cap.
- **F165:** `tickets-notifications.ts` (`ticketEmailFooter`) and `feedback/actions.ts` put **relative** hrefs (`/admin/tickets/{id}`, `/o/{slug}/tickets/{id}`, `/admin/feedback`) in outbound mail, where a relative URL resolves to nothing. Found while converting the senders (D4 rows 3 to 9). Closed by D (`renderEmail` requires an absolute `http(s)` `href`).
- **TODO lines:** F163 palette-literal sweep or tripwire; organizations list pagination beyond the 500-row cap; recovery-mode persistence across a failed `/totp` attempt (low); `check:hydration-gate` generic "every client form" rule (separate decision); the org-tree "test organization" flag question from the Kickoff.
- **CLAUDE.md at integration:** `check:hydration-gate` line under Common Commands also names H3.

## Operator checklist steps

Manual production steps to add to the operator's prod checklist artifact once this pipeline ships (the numbers are suggestions that follow the existing 1.x / 2.x order):

1. **1.1 Google button.** On `/signin`, in light and dark mode and at phone width: the button is white (near-black in dark mode) with a thin grey border and the four-colour "G"; hover and press visibly change it; Tab shows a focus ring; it still starts Google sign-in and lands on `/launch`. On a branded sign-in (a church site's "Member Login") the button is unchanged and the focus ring is the platform blue, not the church's colour.
2. **1.3 Two-factor boxes.** Sign in with an enrolled account. On `/totp`: the cursor is already in box 1; type six digits and each digit advances; Backspace erases and steps back; paste a full code (also try one with a space in it) and all six boxes fill; the phone's numeric keypad appears and the phone's code suggestion (iOS or Android) fills all six; pressing Verify (or Enter) signs in. A wrong code shows the red message and refocuses box 1. Then use "Use a recovery code instead", enter one unused recovery code, and confirm it signs in (a used code must then fail). Also open `/account/2fa` on an account without 2FA and confirm the boxes there behave the same and do not grab focus.
3. **1.1 Email (all mail).** Trigger one of each from production, sending to a real inbox you control (or set `EMAIL_DEV_REDIRECT_TO` on a preview): password reset, email-change confirmation, a feedback submission, a support ticket and a reply to it, a statistics-report grant, a custom-domain notice (claim then remove a test domain), and a giving statement notice if available. In each: the PresbyPortal header, the button, and the plain link printed underneath; the plain-text view exists; the ticket and feedback buttons open the right page (they used to be dead); a "Q&A" or apostrophe in a subject reads normally. Open at least one in Gmail **and** Apple Mail with dark mode on and confirm it is legible. The giving notice must still show no amounts.
4. **1.1 Sender name.** In Vercel, confirm `RESEND_FROM_EMAIL` is `PresbyPortal <noreply@presbyportal.org>`; mail should arrive from "PresbyPortal".
5. **2.1 Organizations.** On `/admin/organizations`: congregations sit indented under their presbytery, presbyteries under their synod, an unaffiliated congregation appears as its own top-level row; the child counts read sensibly; type in a congregation name and see its presbytery above it greyed with no Manage link; pick a type and a status and confirm the URL changes and can be bookmarked; "Still on default palette" still works; "Clear filters" resets; a non-active organization shows a status badge; at phone width the name and Manage stay visible with no sideways scrolling.

## Implementer

Named per batch: **A ux-developer · B full-stack-developer · C ux-developer · D api-developer.**

Hand-off note: Phase 4 starts with A. Judgment agents (qa, analyst) stay read-only. Orchestrator lands DECISION-190/191/192/193, F160 to F165, the TODO lines, and the CLAUDE.md line at integration, and applies the invitations adoption order from R13.

---

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Applied via: `npm run db:push` / `npm run db:generate`

## Audit Events

- [Action key written when the security-sensitive mutation fires]

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS / FAIL

## Unit Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [test name — error — file:line]

## End-to-End Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [...]

## Regression Tests Added

- [test name — file:line — guards against: brief description]

## Coverage on Critical Modules

- `src/lib/permissions.ts`: X%
- `src/lib/two-factor.ts`: X%
- `src/lib/flags.ts`: X%

## Feature-Gate Audit

*(Mandatory — see qa agent. Verified by reading route/action bodies, not by inferring from green tests. Write "no protected routes touched" if none.)*

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| [method + path, or action name] | yes / no | yes / no | `FEATURES.X` or n/a |

## Verdict

[PASS | FAIL | BLOCKED — name the unmet prerequisite]

*(Auth-touching diffs: PASS requires e2e against a real dev server with an MFA-enrolled seeded user; deferred e2e = BLOCKED.)*

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Audit event: [pass | fail | not applicable]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
