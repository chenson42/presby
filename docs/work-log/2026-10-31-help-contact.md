# User help Increment 2 — the /help/contact form — Work Log

> **Slug:** `2026-10-31-help-contact`
> **Surface:** mixed: public `/help/contact` (anonymous, platform palette) and an `/admin` inbox
> **Permission(s):** TBD in Phase 1/3 (the inbox is platform-admin axis)
> **Flag(s):** none expected (operator: no new platform flags pre-live; Phase 2 C1–C10 rule)
> **Estimated complexity:** medium
> **Pipeline mode:** Full
> **Numbers (pre-assigned 2026-10-31, Rule 16):** migration 0083; DECISION-300–304; F382–F391; dev port 3670, production lane 3671; e2e person-id range `00000000-0000-4083-`; Neon branch `pipeline-help-contact` (`br-morning-dawn-axcez4fu`, endpoint `ep-odd-mud-…`); worktree `presby-help-contact`
> **Parent / prior record:** `docs/work-log/2026-10-26-user-help.md` (Phase 2: R1–R14, C1–C10 for the contact form) and `docs/work-log/2026-10-26-user-help-inc1.md` (shipped v0.50.0). The TODO line calls this "User help Increment 2"; the parent log's earlier "Increment 2 = /docs" is now Increment 3.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (11 operator questions with defaults; FC1–FC10 → F382–F391) | READY WITH NOTES | 2026-10-31 |
| 2 — Architectural review | architect | In progress (addendum to the parent's C1–C10) | — | 2026-10-31 |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

*Returned as text by the analyst (read-only) and recorded verbatim by the orchestrator, 2026-10-31.*

**Pipeline:** `2026-10-31-help-contact` · **Worktree:** `/Users/cshenso/git/presby-platform/presby-help-contact` (main at 0.50.1) · **Date:** 2026-10-31 · Read-only. No file was written. No real name, address or email appears here.

I read the parent Phase 1/2 record (Q3, R1–R14, C1–C10), the Inc 1 Phase 6 and follow-ups (F374), `src/lib/help/contact.ts`, the help registry and the eleven pages that use `{{contact}}`. I also read `src/proxy.ts`, `src/lib/turnstile.ts`, `src/lib/rate-limit.ts`, `src/lib/request-ip.ts`, the site contact-form action (DECISION-083 precedent), the admin nav, dashboard registry and feedback page, and the email-audience registry.

## VERDICT

**READY WITH NOTES.**

- The shape is right and C1–C10 hold. Nothing needs to go back to the user before design.
- Ten gaps need a Phase 2/3 answer. Four of them are real functional holes in the rulings as written: the reply channel, the kill switch, coalescing, and retention.
- Operator question Q7 (Turnstile and Upstash configured in Production) gates **shipping**, not design.

## ONE-LINE TAKE

> An anonymous visitor writes a short message at `/help/contact`; it lands in a platform-only drop box that the operator reads, triages and answers by hand from outside the system; the 13 help sentences that today dead-end at "Ask the person who invited you" gain a way out.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Anonymous visitor (also a signed-in member, or a user mid-enrolment: the page reads no session) | Opens `/help/contact` from a help sentence, the help index, the help 404, or by typing the URL | on demand |
| Anonymous visitor | Picks a topic, types name, email, congregation (optional) and message, completes the Turnstile check, selects "Send message" | one-time per need |
| Anonymous visitor | Reads one outcome: sent, not sent (fixable), or unavailable | per submit |
| Admin (platform operator, `FEATURES.ADMIN_TICKETS` per C7) | Receives a content-free notification email (at most one per window) and opens the inbox | per window |
| Admin | Opens the inbox (newest first, "new" first), opens a message, reads it as plain text | on demand |
| Admin | Marks a message handled or spam (status only) and clears a message's personal details | per message |
| Admin | Replies **outside the system**, from their own mailbox (see FC1) | per message that needs it |

Nobody in the member or tenant-admin surfaces acts on this feature. It sits on the platform axis only.

## Flows

**Flow 1: a prospect with no inviter.**
- Entry: the "How a congregation gets started" page. Its GitHub sentence becomes the form link.
- Steps: topic "Starting a congregation", then email, then message, then the Turnstile check, then "Send message".
- Outcome: one success state replaces the form. It says the message was sent to the PresbyPortal team and that a person reads it. It says there is no automatic reply and no promised time. It says a reply, if one is needed, comes by email from a person.
- Failure: field errors sit beside the field, and the typed text is kept. A database error says "Your message was not sent" and keeps the text. Per-IP or global limit says "We can't take messages right now. Please try again later." Turnstile failure or script blocked is shown in words (FC9, Gap 6).

**Flow 2: a member who hit "ask the person who invited you" and has no inviter.** This is the 13 `{{contact}}` sentences (Help impact). The form is reached from the sentence. The flow is otherwise Flow 1.

**Flow 3: a locked-out person (lost phone and codes).**
- Today the help says "Ask a church administrator to send the team a support ticket." A sole administrator has no one to ask.
- The form is the only remaining door. A message there is a claim, never proof (FC2). The success copy must not promise recovery.

**Flow 4: the operator.**
- Entry: a content-free email, or the dashboard.
- Steps: `/admin` inbox, open a message, read it as plain text, copy the typed address, reply from a personal mailbox, mark it handled.
- Failure: if the inbox read fails, the standard `LoadError`. No `loading.tsx` under `(admin)/admin` (DECISION-251).

**Flow 5: unconfigured or switched off.**
- Turnstile keys or Upstash are missing in a production deployment, or the operator pulled them as the kill switch.
- The page renders the unavailable state instead of the form (C3, C10).
- Failure of the failure: if that state has no exit, the visitor is at a dead end again (FC9).

**Flow 6: on a church's custom host.**
- The proxy classifies the host first and rewrites `/help/contact` to `/site/<host>/help/contact`. That is a church page or the neutral 404.
- `/help/contact` is already in `e2e/custom-domains/lockdown.spec.ts` (line 125). The proof is that **the action** is not reachable there either (adversarial pass).

## Permissions & Flags

- **Anonymous form:** no permission. A credential-free write is the point. The proxy bypass for `/help` and `/help/*` (segment boundary) already sits before `edgeAuth` and the 2FA gate, so the form is reachable mid-enrolment. That is correct and wanted, since a person locked out of 2FA is the likeliest visitor.
- **Inbox:** reuse `FEATURES.ADMIN_TICKETS` (C7). I accept it. `ADMIN_FEEDBACK` also exists and the Feedback page is its sibling, but an anonymous message to the team is closer to support than to member feedback, and it avoids a new key in the frozen catalog. Three things must follow from it:
  - The nav item and the dashboard card carry the **same** key as the page (`visible-nav.test`).
  - The notification recipients are the holders of that key, not the `ADMIN_ROLE` holders the `feedback_notification` precedent uses (FC4).
  - A page-level `auth()` plus `hasFeature` check, as the Tickets and Feedback pages do.
- **Flag:** none. This matches the operator's "no new platform flags pre-live" and C10. The two real gates are:
  - **Environment:** Turnstile site key, Turnstile secret, and Upstash URL and token. Without them the page renders "unavailable".
  - **Sequencing:** the 13 help sentences must not point at a form that renders "unavailable" in production (FC9).
- **Rollback:** remove the environment variables for the server-side half (FC3). The client site key is `NEXT_PUBLIC_*`, baked in at build, so a visibly different page needs a redeploy. Otherwise unlink and redeploy.
- No per-org toggle applies. There is no tenant.

## Test of each C-ruling, as written

| Ruling | Holds? | Functional gap |
|---|---|---|
| **C1** insert-only drop box | Yes | `INSERT … RETURNING` needs SELECT. With an insert-only grant, no `.returning()` works, so no reference number can be shown or used. Coalescing (C5) also needs a read. Both are Phase 2 items (FC4). |
| **C2** not a ticket | Yes | The UI, the success copy and the help must never say "ticket". |
| **C3** honeypot, Turnstile, per-IP plus global | Mostly | FC3 (kill switch fails open), FC5 (audit write per blocked call), FC7 (silent loss), FC9, Gaps 6–7. |
| **C4** enumeration-neutral | Yes | The rate-limit key and its audit row must not embed the typed email (FC5). |
| **C5** never mail the typed address; content-free notice | Yes, with holes | FC1 (no human reply path stated), FC4 (coalescing mechanism, recipient set). |
| **C6** audit on triage | Yes | Add an audit key for "clear details" as well as for status. |
| **C7** `ADMIN_TICKETS` gate | Yes | Align nav, card and notification recipients with the key. |
| **C8** plain text, bounded lengths | Partly | Plain text does not defeat bidi-override or zero-width spoofing, and a NUL character breaks a Postgres text insert (FC8). |
| **C9** retention posture | Open | Proposed below (FC6, Q4). |
| **C10** no flag, kill switch | Partly | FC3. |

## Gaps the Request Didn't Address

**Finding candidates (for the orchestrator to number from F382).**

- **FC1. No stated way for a prospect ever to hear back.**
  - C5 forbids the **system** from mailing the typed address. Nothing states that a **person** may reply, or how.
  - Without that sentence, Phase 2/3 could read C5 as "nobody replies", and the form would be a black hole for exactly the prospects it exists for.
  - Resolution: the operator replies from their own mailbox, outside PresbyPortal, copying the address from the inbox.
  - The success copy and `getting-help` "What to expect" promise neither a reply nor a time. They say "no automatic email is sent", so a visitor who sees no confirmation does not think it failed.
  - An in-app "Send reply" is explicitly out of scope and becomes a tracked follow-up. It would need its own Phase 1: an open-relay review, and shared Resend reputation with password resets.

- **FC2. An anonymous message is a claim, not proof, and the operator can be socially engineered through it.**
  - "I am the administrator at X, please reset my 2FA", "please give me `events.manage`" and "send me the invitation again" are all plausible.
  - The existing invariant says a contact email authenticates nothing.
  - Resolution, in a short operator runbook and in the help copy (never promising recovery):
    - Never act on a role or 2FA request from a form message alone.
    - Reply only to the account's own on-file address, looked up in `/admin/users`, not the typed one.
    - Prefer the ticket route for signed-in administrators.
  - The inbox detail view labels the typed address "Not verified. Anyone could have typed this."

- **FC3. The kill switch is not a kill switch as written.**
  - `verifyTurnstile` returns `true` when `TURNSTILE_SECRET_KEY` is unset (a no-op). The page is static and the site key is inlined at build.
  - If the secret is removed after the form was built, the page still shows a form and the action silently accepts it, guarded only by the honeypot and the limiter.
  - Resolution: the action performs its **own** configured-check (secret, and Upstash in a production deployment) and refuses with the same unavailable result. That makes the server half of C10 immediate.
  - The Cloudflare-outage fail-open (DECISION-026) stays as ruled. The global ceiling bounds it. Record that as accepted.

- **FC4. "Coalesced, at most one per window" has no mechanism, and the recipient set is inconsistent.**
  - With an INSERT-only grant the action cannot ask "was one already sent?".
  - Using `checkRateLimit` as the coalescer would write a `RATE_LIMIT_BLOCKED` audit row for every coalesced message.
  - C5 names the `feedback_notification` precedent, which mails every `ADMIN_ROLE` holder. The inbox is gated by `ADMIN_TICKETS`.
  - The ticket-notification code already resolves "holders of `ADMIN_TICKETS`".
  - Resolution: Phase 2 picks the coalescer: a definer function, or a small "last notified" row, or a digest on an existing cron. Recipients are the holders of the key that gates the inbox. Send with `after()` or equivalent so a serverless freeze does not drop the mail.
  - Related: a content-free email makes the **dashboard count** the real signal. Add a "Messages" card in the Support zone with the same key.

- **FC5. The shared limiter turns a flood into an audit-table flood.**
  - `checkRateLimit` inserts an audit row on every blocked call. A bot past the per-IP or global limit writes one row per request into `audit_events`, which is kept forever.
  - Also, the existing keys embed whatever the caller passes. This form's key must carry the IP only, never the typed email, name or congregation.
  - Resolution: Phase 3 bounds it (audit only the first block per window, or a form-specific call that does not write per block) and documents the choice.

- **FC6. Retention and privacy of strangers' data.**
  - Soft-delete means the rows live forever by default. The policy page says audit records are not deleted on a schedule, but it says nothing about stranger messages. See Q4.
  - The form is the first place PresbyPortal collects free text from people with no account.
  - Resolution:
    - Store only name, email, congregation, topic, message, timestamp, status, and who handled it and when. **No IP, no user agent.**
    - Add a point-of-collection notice and a link to `/help/privacy-policy`. The notice says what we keep, that the message is read by the team, and "do not include passwords, recovery codes, or private details about other people".
    - Add a "Clear details" action for archived messages: the row stays with a status, and name, email and message are blanked. That is an update, not a DELETE, so it is consistent with the soft-delete rule.

- **FC7. The honeypot silently loses real messages.**
  - A password manager or browser autofill can fill a hidden field. The visitor is told "sent" and the message is dropped.
  - Resolution:
    - Give the honeypot a name no autofill matches (not `email`, `website`, `url`).
    - Set `autocomplete="off"`, `tabindex="-1"` and `aria-hidden`, and position it offscreen (not `display:none`).
    - Do not add a second silent-drop heuristic such as a timing trap.
    - Note that the DECISION-083 precedent's `_hp` name is fine, but its accessibility handling must be checked here.

- **FC8. Input boundaries (server-side; the client is advisory).**
  - Strip or reject NUL and other control characters before insert. A NUL makes Postgres throw, which would surface as a 500 or a false "not sent".
  - Normalize Unicode (NFC). Count lengths in characters, not bytes. Suggested bounds: name 100, congregation 150, email 254 (format only, **no** MX or deliverability lookup), message 10–2000 (matches feedback).
  - Topic is a closed list validated server-side. The client never supplies status or timestamps.
  - On the operator side, plain text still permits bidi-override and zero-width spoofing. Render each field in an isolated, `break-words`, `whitespace-pre-wrap` container and strip bidi override characters on save.

- **FC9. The unavailable state and the rollout order create a new dead end.**
  - Once `{{contact}}` points at the form, an "unavailable" form is worse than today's "ask your inviter".
  - Resolution:
    - The unavailable state keeps an exit: "Ask the person who invited you", plus the public repository link with the standard "issues are public, leave personal details out" warning (the `HELP_PRIVACY_CONTACT_FALLBACK` precedent).
    - Ship order: set the Turnstile and Upstash variables in Production (and the Cloudflare widget's allowed hostnames, including the production host) **before** merge, and walk the form in production-like configuration at Phase 6.
    - Preview deployments will correctly show "unavailable", since their hostnames are not on the widget's list. Say so in the runbook.

- **FC10. The help edit is larger than the constant plus one sentence.** See Help impact. In short:
  - Replacing `{{contact}}` fixes 13 sentences, but several are read by a signed-in administrator whose better channel is a ticket (it has a reply and a verified identity).
  - `getting-help` ("three ways to get help") and `privacy-policy` ("Messages to us", retention, "last updated") become false or incomplete if not edited.

**Notes (not findings).**

1. **Success state and double submit.**
   - The form is replaced by the success message and focus moves to it (`role="status"`). There is no reference number (FC-C1).
   - "Send message" disables while pending.
   - A refresh or a double-click can create a duplicate. The cost is a duplicate row for the operator. Accept it, with a client-generated idempotency key as optional design.
   - A failure keeps the typed text. Only success clears it.
2. **No JavaScript, or Turnstile script blocked** (extensions, school or church networks). The form cannot be operated. Say it in a `<noscript>` and in an `onError` message ("The check didn't load. Turn off content blockers for this page, or try another browser."), with the same exit as the unavailable state. The existing widget disables submit on a blank token, and the page needs a visible reason, not a dead button.
3. **Hydration.** If the form uses `useForm`, it needs `<HydrationGate>` (`check:hydration-gate`). If it is a plain `<form action>` with local state, the disabled-until-token submit is the equivalent guard. Phase 3 states which.
4. **Static group.** `(documentation)` is `dynamic = "error"` with no `loading.tsx` or `error.tsx`. The contact segment is the one exemption (C1, Phase 2 R-note). It needs a narrow, named carve-out in `check:help` H19 and in `shell-boundaries.test.ts` (the action file only), not a blanket relaxation. The page shell stays static and the client island and the action carry everything dynamic. The unavailable decision is therefore build-time for the page and run-time for the action.
5. **Live limiter coverage.**
   - `RATE_LIMIT_DISABLED=true` is set in both e2e web servers (`playwright.config.ts` 159 and 180), so no limiter is ever exercised live.
   - This form's limits are the abuse defence, so at least one e2e must run with the override off, or against a stubbed ceiling. The existing TODO item (7 in the submission-grants follow-ups) is the same defect.
   - Cloudflare publishes dummy Turnstile test keys. They are public and not secrets, and they are the way to run e2e. They must never be set in Production, and the runbook says so.
6. **Accessibility at 360px.**
   - Single column, 16px inputs (no iOS zoom), visible labels above fields (not placeholders), 44px send button, and the Turnstile widget (300px, fits 360 minus padding).
   - Errors are linked with `aria-describedby`, and an error summary receives focus on failed submit.
   - The character counter announces politely at thresholds, not per keystroke.
   - Correct `autocomplete` (`name`, `email`, `organization`), `inputmode="email"`, and light and dark checked.
   - No colour-only status.
7. **Admin at 360px.** The operator likely triages on a phone. Use the Feedback page's card layout for the list, not a wide table. Wrap long text. Keep the control row large enough for touch.
8. **`/help/contact` is a route, not a registry page.** The registry already reserves the slug (`RESERVED` in `checks.ts` 69). The link resolver (`links.ts`, `helpHref`) must know the route, or the `{{contact}}` replacement fails H-link checks. Phase 3 item.

## Adversarial Pass

- **Redirect targets.** The form takes no `callbackUrl` or `next`, and success does not redirect. Confirmed by design. Keep it that way; no "return to" parameter.
- **State-machine shortcuts.**
  - Posting the action without the page, with no Turnstile token, with an empty or reused token, or with a token minted for another site fails. The unconfigured case must **refuse** (FC3), not pass.
  - The honeypot and the token are independent checks.
  - The action cannot set status, handled-by or timestamps.
- **Custom host.** The proxy classifies by host first, so the page is a church's own page or the neutral 404.
  - The e2e must also **POST the action** (Next-Action header) to a custom host and prove no row is written and no distinguishing response is returned (the TODO's "contact form and Server Action Origin" acceptance step is the same question).
  - There is no cookie, session or CORS surface.
- **Enumeration.**
  - Single success response, no lookup on typed email, name or congregation (C4).
  - The per-IP limit message reveals only the caller's own count.
  - Honeypot and success latency differ only in a way that tells the bot nothing about any user.
  - No confirmation email (C5), so no "this address exists" side channel.
  - Sending to the typed address would also let anyone spam a third party through our domain.
- **Per-IP limit evasion.**
  - `getRequestIp` trusts `cf-connecting-ip` unconditionally (DECISION-017's comment says Vercel strips unrecognized headers).
  - Phase 2/5 must verify on a real Vercel deployment that a client-supplied `cf-connecting-ip` cannot rotate the key.
  - Until proven, treat the **global ceiling as the primary bound** and the per-IP limit as a courtesy. A request with no IP at all should count only against the global ceiling, not share one `unknown` bucket that locks out everyone.
  - Accepted residual: an attacker can spend the global ceiling and block honest senders for that window. The unavailable-style message is honest about it, and the audit row (FC5) is the detection.
- **Input boundaries.** FC8. Empty form and whitespace-only message fail server-side. Overlong strings are rejected, not truncated silently. Control characters are rejected. Email is format only.
- **Stored content abuse.** Links, phishing text and markup in the body are shown as inert text, never markdown, HTML or auto-linked (C8). The notification email carries no content. The operator copies, never clicks, the address. That blunts both phishing the operator and using the operator as a relay to a third party's typed address.
- **Self-targeting.** No tenant or account action exists on this surface. An operator marking, clearing or archiving writes their own id into `handled_by`. A platform admin gains nothing over any tenant (no cross-axis authority). The inbox shows data about people who are not users, and no other surface joins it.
- **Open relay and reputation.** Confirmed by C5. No path sends mail to a typed address.

## Out of Scope (confirm with user)

- An in-app reply from the operator (FC1) and a visitor-facing status or reference page.
- Attachments, a CAPTCHA vendor other than Turnstile, and message threading.
- Auto-expiry or purge sweeps (see Q4; a sweep is a follow-up).
- Turning the form into a ticket or any link to an organization or person record (C2, C4).
- A what's-new entry (operator standing rule).
- A new platform flag or per-org toggle.
- Putting the form on a church's own site. That is the existing site contact form, a different feature that goes to that congregation.

## Help impact

Workflow Rule 17 applies: a public route, and a string in `src/lib/help/contact.ts`, are visible to non-operators. No `[help:<token>]` is needed (ordinary case). The feature's own branch edits its pages as `published`, in the same PR. Phase 6 re-walks each page at 360px and moves `verifiedIn` only by that walk.

**Pages to edit:**

- **`HELP_CONTACT_LINE` (`src/lib/help/contact.ts`).** It reaches **13 `{{contact}}` lines on 11 pages**. The brief says "about 14"; I count 13 by grep. The pages are `getting-help`, `why-cant-i-see-this`, `roles-who-can-do-what`, `first-day-as-administrator` (2), `events-and-the-calendar`, `signing-in`, `who-is-asked-for-a-code`, `your-congregations-website` (2), `turning-features-on-and-off`, `reimbursements-for-treasurers`, `accepting-your-invitation`.
  - Proposed text: "Ask the person who invited you, or [send the PresbyPortal team a message](/help/contact)."
  - Keep the inviter route, because for a member their administrator is the right and faster answer.
  - Phase 3 reads each of the 13 as its reader. Where the reader is a signed-in administrator, name the ticket route as well (FC10).
  - The `{{contact}}` replacement in the deactivated-account sentence (`signing-in`) is checked separately: that reader cannot sign in.
- **`getting-help`.** The intro ("three ways to get help") becomes four.
  - Add "Write to the PresbyPortal team": no account needed, a person reads it, no automatic reply, no promised time, not for passwords or recovery codes.
  - Say how it differs from "File a ticket" (administrators, with a reply thread).
  - Edit "What to expect" to include messages. Add the form's labels to the entry's `labels` and its route to `covers`.
- **`how-a-congregation-gets-started`.** Replace the "does not have a contact form … open an issue on GitHub" sentence (line 23) with the form. Say what to write (congregation name, who the first administrator would be).
- **`privacy-policy`.** This is a **required** edit, because the policy becomes incomplete without it:
  - "Messages to us" gains the contact-form message (what is kept).
  - "How long we keep information" gains the retention rule, which must match what ships.
  - "What you can ask us to do" gains clear-on-ask.
  - "Other companies" is unchanged (Turnstile and Upstash are already named; Resend is not involved for the visitor).
  - Update "Last updated".
  - Privacy and account requests keep their own address (`{{privacyContact}}`); say the form is for everything else.
  - The `HELP_PRIVACY_CONTACT_FALLBACK` GitHub sentence (unset-env only) can stay.
- **`using-your-code` and `setting-up-two-factor`** (lost-phone paragraphs). Read them. If Q3 is accepted as the default, add one sentence for a sole administrator ("If you are the only administrator, write to the team using the contact form. We will reply only to the address on your account"). Otherwise leave them (they already match F374).
- **Help chrome:** the help index, the help 404 and the footer gain a "Contact us" link (`HELP_COPY` strings). Phase 3 drafts them.
- **Marketing home page** (`src/app/page.tsx`): its "Get involved" sentence names the repository for issues. This is Q8.

**Not changed:** no placeholder is retired. No token is released. No `limitationUntil` sentence concerns this feature (I found none). I did not grep for `limitationUntil` text exhaustively, so Phase 3 should.

**Also at ship (Rules 10, 14):** `docs/TODO.md` line to Done, `docs/product/functionality-map.md`, release note, `docs/deployment.md` (the three environment variables and the Cloudflare hostname step), and an operator runbook note (FC2).

## Open Questions

Each has a proposed default. Q1–Q7 are the ones the design depends on.

1. **Reply channel (FC1).** Default: the operator replies by hand from a personal or role mailbox, outside the system. The success copy promises no reply and no time, and an in-app reply is a tracked follow-up.
2. **Email required?** Default: required, because three of four topics need a reply, and the field says "so we can reply". All other fields optional except the message.
3. **Lost-access use (FC2).** Default: the form may be used by a sole administrator, but a message is never itself authority. The runbook says: reply to the account's on-file address, verify, then use the existing 2FA reset. Say so in `using-your-code` and `setting-up-two-factor`.
4. **Retention (FC6).** Default: archived messages are kept hidden; a "Clear details" action blanks name, email and message and keeps the row. The policy promises only what the build does (for example "kept until we clear them; we clear them when you ask or when we have finished with them"). No automatic sweep in this increment, so the policy states no period. A timed sweep (for example 12 months after handling) is a tracked follow-up.
5. **Statuses and inbox.** Default: `new`, `handled`, `spam`. The list defaults to "new". Each handled or spam change records who and when. A dashboard "Messages" card (same key) shows the new count. No internal note field.
6. **Limits.** Default: per IP 3 per hour; global 30 per hour and 100 per day. Message cap 2000 characters. The message at any limit is one neutral "can't take messages right now, try later" sentence. Expected real volume is a handful a month, so the numbers are generous for honest use and tight for abuse.
7. **Production readiness.** Confirm Turnstile keys (site and secret), the Cloudflare widget's allowed hostnames, and Upstash URL and token are set in Production, and that no Cloudflare test key is. Default: operator sets them before merge, in the Vercel Production scope, and redeploys (the site key is baked in at build). If any is missing the form shows "unavailable" and the help sentences must not yet link to it. Dev and e2e use Cloudflare's public test keys.
8. **Marketing home page.** Default: leave it. The "Get involved" sentence is about the open-source repository, not about starting a congregation. Add a "Contact us" link only if you want prospects to reach the form from `/`, which is their first stop.
9. **Gate.** Default: accept C7 (`ADMIN_TICKETS`, no new key, no flag). Notification recipients are the holders of that key (FC4).
10. **Fail posture.** Default: keep C3's fail-open on a Cloudflare outage, with the global ceiling as the bound.
11. **Topics.** Default: a closed list of four: "Starting a congregation", "I can't sign in or I lost my codes", "A help page is wrong", "Something else". The topic is a triage hint only and decides nothing.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (11 operator questions with defaults; 10 finding candidates FC1–FC10, to be numbered F382–F391) | READY WITH NOTES | 2026-10-31 |

## Handoff note

**Next agent: architect (Phase 2 addendum).** It must read the live catalog on branch `pipeline-help-contact` (`aclexplode(relacl)` and `pg_policies`) to confirm the insert-only grant for `presby_app`. Its other points:

- `INSERT … RETURNING` with no SELECT (C1).
- The coalescing mechanism and the notification recipient set (FC4).
- The audit-per-block behaviour of `checkRateLimit` (FC5).
- Whether `cf-connecting-ip` can be spoofed on Vercel (adversarial).
- The narrow H19 and `shell-boundaries` carve-out for the contact segment (Note 4).
- A static page with a server-side configured-check (FC3).

Tech-lead (Phase 3) then drafts the Copy table, including all 13 `{{contact}}` readers and the privacy-policy sentences, and the operator runbook text for FC2.

**Phase 6 walk, stated now so the design plans for it:**

- Walk as an anonymous visitor at 360px on a dev server with the public Turnstile test keys, with Turnstile blocked, and with the variables removed.
- Walk as a user mid-enrolment.
- Walk as the operator, reading the inbox at 360px and replying by hand.
- Walk a custom host (page and action).
- Read all 13 help sentences, `getting-help`, `how-a-congregation-gets-started` and `privacy-policy` as their readers.
- Confirm the privacy policy's retention sentence matches the shipped behaviour.

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

[One paragraph: what we're building and why.]

## Permissions & Flags

- Permission key(s): `area.action`
- Default role bindings: [list]
- Feature flag(s): [key, or "not needed"]

## API Contract

- `POST /api/...` — purpose, request body, response shape
- `GET /api/...` — purpose, query params, response shape
- Or server-action signatures: `async function actionName(input): Promise<Result>`

## Data Model

[New tables / columns / indexes, or "No schema changes required."]

## Component / Page Plan

- Pages to create: [list]
- Components to create: [list]
- Files to modify: [list]
- Help pages to add or edit: [slug and the Copy rows that feed them], or "no help impact"

## Implementation Order

1. Schema (if any) → `npm run db:push` on a Neon branch
2. `FEATURE_CATALOG` entry + seed binding
3. Route handlers / server actions
4. UI
5. Audit events for security-sensitive paths
6. Release notes entry

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| [gap or ruling] | [section, or deferred + who accepted] |

## Edge Cases & Risks

- [Thing that could fail or that needs special handling; each claim cites the test that pins it or says "unverified"]

## Copy

- [Every user-facing string, checked against the accepted residuals: copy may not deny a residual the record admits]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

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

Strings added or changed: [file:line each, or "none"]

*Keep Phase 4 sections short: files, deviations from the design, gates with
counts, and anything the next phase must know. Leave out narration of how
the work went; git history already records it. Judgment output (analyst,
architect, qa) is still recorded verbatim.*

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

## Copy Truthfulness

*(Every run whose diff adds or changes a user-facing string; write "no strings changed" otherwise. Report a defect as `copy truthfulness: FAIL` with file:line and the viewer's role.)*

- [ ] Every added or changed string is in the design's Copy table
- [ ] The query behind each claim about a person, account, date or state was opened, and what it does not read was named
- [ ] Each instruction was traced to the role that sees it, and that role can do it (render gate and permission check)
- [ ] Older strings about the same subject were grepped for and none is made false
- [ ] Help diff covered: every labels string is on screen, every claim walked at 360px, every committed image opened

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
- Help pages read as their reader (each page named in Help impact): [pass | fail | no help impact]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
