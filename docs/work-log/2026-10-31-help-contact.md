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
| 2 — Architectural review | architect | Complete (CA1–CA13; amends C1, C3, C5, C6, C10, R9; AF-1–AF-8 = F406–F413; DECISION-300–304 proposed) | Approved with suggestions | 2026-10-31 |
| 3 — Technical design | tech-lead | Complete (Batches 1 to 5; DECISION-300 to 304 text and the runbook drafted) | Design complete, implementer named | 2026-10-31 |
| 4 — Implementation | database-admin (Batch 1), then full-stack-developer (Batches 2 to 5) | Pending | — | — |
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

*Returned as text by the architect (read-only) and recorded verbatim by the orchestrator, 2026-10-31.*

**Orchestrator numbering (Rule 16):** AF-1 to AF-8 take **F406–F413** in order (F392–F405 are event sign-ups' block). Operator defaults for Phase 1 Q1–Q11 stand unless the operator objects (put to the operator 2026-10-31).

## Phase 2: Architectural Review (architect), addendum for Increment 2 (the `/help/contact` form)

**Pipeline:** `2026-10-31-help-contact` · **Worktree:** `/Users/cshenso/git/presby-platform/presby-help-contact` (HEAD `b17c587`, main 0.50.1) · **Neon branch:** `pipeline-help-contact`, read with `PGOPTIONS='-c default_transaction_read_only=on'` (confirmed `on`); no connection string printed · **Date:** 2026-10-31 · Read-only. No file was written.

This is an addendum. **C1–C10 and R1–R14 from the parent stand except where amended below.** Each amendment gives its reason.

### Verdict

**Approved with suggestions.** The feature's shape is right and nothing goes back to Phase 1.

The live catalog changes how the write is built. No table on this database gives `presby_app` INSERT on its own. Every credential-free write in the codebase goes through a narrow `SECURITY DEFINER` function. So C1's "INSERT-only grant" option is off-pattern, and the definer function becomes the only option.

Two of the analyst's premises are false on this deployment:
- Removing environment variables is not an immediate kill switch on Vercel (AF-3).
- `cf-connecting-ip` is not proven unspoofable (AF-2). That second one is a platform-wide finding, outside this pipeline.

Neither blocks the design. Both change what Phase 3 may claim.

**Amended rulings:**
- **C1:** the table moves from `schema.ts` to a domain file, and the write is definer-only.
- **C3:** the order of checks changes.
- **C5:** the notification goes to holders of `ADMIN_TICKETS`.
- **C6:** `check:audit` cannot see the triage writes, so a test pins them.
- **C10:** the kill switch is restated.
- **R9:** no `error.tsx` for the contact segment.

### Placement

- **Directory placement:**
  - **Table:** `src/lib/db/domain/help-contact.ts` for the TypeScript mirror, with a header saying `drizzle/0083_presby_help_contact.sql` is the ground truth. **Amends C1 ("in `schema.ts`").** `drizzle.config.ts` reads only `schema.ts`, so Drizzle Kit emits nothing for domain tables. Most of what makes this table safe cannot be expressed in Drizzle Kit: no `presby_app` grant, FORCE RLS, the guard triggers, the definer function. `account_invitations` (`src/lib/db/domain/invitations.ts`) is the exact precedent. The `domain/index.ts` re-export and the `drizzle/meta/_journal.json` entry are Rule 16 shared files, edited at integration only.
  - **Migration `0083`,** hand-written, named `drizzle/0083_presby_help_contact.sql`.
  - **Server library: a new `src/lib/help-contact/`, not `src/lib/help/`.** `src/lib/help/**` is an H19 entry tree and is database-free by rule. Putting a database writer there would need an exemption inside the boundary's own library. Contents:
    - `contract.ts`: pure and client-safe. Topic keys, length bounds, the outcome union.
    - `validate.ts`: pure. Uses the lifted text-hygiene helpers (CA12).
    - `configured.ts`: a pure function of `env` (CA6).
    - `submit.ts`: `server-only`. Limiter, definer call, enqueue.
    - `notify.ts`: `server-only`. Recipients and the rendered email.
    - `inbox.ts`: `server-only`, and **the only file here that may call `getPlatformDb()`**.
  - **Public route:** in `src/app/(documentation)/help/contact/`:
    - `page.tsx`: a static Server Component, `dynamic = "error"`.
    - `contact-form.tsx`: the `'use client'` island.
    - `actions.ts`: `'use server'`, thin, delegates to `submit.ts`.
    - No `loading.tsx`. No `error.tsx` either. **Amends R9's note:** the page does no data fetching at render, so `docs/ui-standards.md` line 542 does not apply. Action failures are typed results, and the island catches an unexpected throw as "not sent".
  - **Admin inbox:**
    - Route: `src/app/(admin)/admin/messages/`, with `page.tsx`, an optional `[id]/page.tsx` using `notFound()`, `actions.ts`, a status control, and a clear-details `AlertDialog`.
    - The page checks `auth()` and `hasFeature(..., FEATURES.ADMIN_TICKETS)` itself. No `loading.tsx` (DECISION-251).
    - Nav: a "Messages" item in the `support` zone of `src/lib/admin-portal/nav.ts`, with `requiredFeature: FEATURES.ADMIN_TICKETS`.
    - Dashboard: a count-only reader at `src/lib/admin-portal/dashboard/messages.ts` (`status = 'new'`, the `feedback.ts` shape), registered in `src/app/(admin)/admin/_dashboard/registry.ts` with the same key. `help_contact_messages` is added to `boundaries.test.ts`'s allow-list on purpose, in review.
  - **Audit keys:** two new `AUDIT_ACTIONS` entries in `src/lib/audit.ts`, one for status change and one for details cleared. Phase 3 matches the file's naming convention. Refusals reuse `RATE_LIMIT_BLOCKED` (CA5).
  - **Email:** template key `help_contact_notification`, registered in `src/lib/contact-methods/email-audience.ts` as `account`.

- **Server vs client split:** everything is a Server Component except:
  - `contact-form.tsx`: Turnstile widget, honeypot, fields, and the success, failure and unavailable states. If it uses `useForm` it renders `<HydrationGate>`. If it is a plain `<form action>`, the submit stays disabled until hydrated and a token exists. Phase 3 says which; `check:hydration-gate` applies either way.
  - The admin status control and clear dialog.

- **Dependencies: none new.** Turnstile (`src/lib/turnstile.ts`, `src/components/shared/turnstile.tsx`), Upstash (`@upstash/ratelimit`, `@upstash/redis` through `src/lib/rate-limit.ts`), the email queue, `after()` from `next/server` (already used in `src/app/api/webhooks/stripe/route.ts`), and `zod` all exist. Cloudflare's published test keys are configuration values, not a dependency.

### Invariants Touched

- **Isolation Is a Database Property:**
  - `presby_app` holds **no** privilege on `help_contact_messages` (CA1).
  - FORCE RLS is enabled **with no policy**, so any role without BYPASSRLS reads and writes nothing even if a future migration grants it by mistake.
  - `neondb_owner` (the `getPlatformDb()` role and the definer owner, `rolbypassrls = t` on the live catalog) is unaffected.
  - This is the first FORCE-RLS table on the catalog with zero policies (I checked: none exists today). The migration comment says it is deny-all on purpose.
- **Never hard-delete / all deletes soft:**
  - DELETE is revoked from everyone, and a `BEFORE DELETE` guard raises on the owner path too (the `account_invitations_guard_delete` precedent).
  - "Clear details" is an UPDATE, held by a `BEFORE UPDATE` guard (CA1).
- **The Proxy Does Not Reach the Database:** `src/proxy.ts` is untouched. `/help/contact` is already covered by the `/help/` segment bypass (`isDocumentationPath`). `check:proxy-imports` is unaffected. Because the proxy is not edited, **this pipeline is not auth-touching** by the Phase 4 gate. The shared `rate-limit.ts` refactor (CA5) is on the sign-in path, though, so see the Notes.
- **A Custom Host Is a Key, Not an Identity:** the proxy's first branch rewrites a custom host's `/help/contact` into `/site/<host>/…`. On top of that, **the action refuses unless `isPlatformHost(requestHost(await headers()))`** (CA7). The site contact action already re-derives the host in its own body (`resolveSiteOrganization`), so this has precedent. It makes "not reachable on a custom host" a property of the action itself, independent of Next's Server Action routing and forwarding, which I cannot prove from source. The e2e POST in `e2e/custom-domains/lockdown.spec.ts` is the running proof.
- **The Brand Is a Cascade Override:** `(documentation)` is platform palette with no `BrandTokens`. `check:brand-scope` is unchanged. `/admin/messages` is platform palette.
- **Permissions vs Flags:**
  - The inbox, nav item, card and notification recipients all use `FEATURES.ADMIN_TICKETS`. `src/lib/permissions.ts` stays frozen.
  - No flag.
  - No credential: the anonymous write authorizes nothing.
  - The typed email authenticates nothing. It is never matched against `users`, `contact_methods` or `people` (C4 and DECISION-216 hold inside the definer).
  - The action never calls `auth()`. A signed-in sender is anonymous to the system.
- **Two Hierarchies:** platform axis only. There is no `organization_id` and no person id. "Congregation" is free text, never resolved to an organization.
- **No Real Data:**
  - Fixtures use `example.invalid`.
  - Real submissions exist only in the production database.
  - Cloudflare's public test keys may appear in `.env.example` or e2e configuration only, annotated `// leak-ok:` if `check:secrets` flags them, and the runbook says they must never be set in Production.
- **`loading.tsx` rule:** none under `(documentation)` (pinned) and none under `(admin)/admin` (pinned).
- **Verify in a Browser:** both surfaces at 360px, light and dark. The public form also with Turnstile blocked.
- **CLAUDE.md and agent-file edits** (orchestrator, with operator approval; no agent can authorize them):
  - A Project Layout line for `src/lib/help-contact/`.
  - The `(documentation)` route-group rule in `.claude/agents/architect.md` gains: "one named `'use server'` file, `help/contact/actions.ts`, is a stop in H19's walk (CA9)".
  - `docs/architecture.md`: **no update** (Rule 15). A drop box is not a new subsystem.

### Notes

#### Finding numbers

The pre-assigned block F382–F391 is used up by the analyst's ten candidates. My findings below are labelled **AF-1 to AF-8**. The orchestrator assigns them numbers from the next free block. I have not invented numbers that could collide (Rule 16).

| Analyst | F-number | Architect ruling |
|---|---|---|
| FC1 (no human reply path) | **F382** | Accepted: the operator replies by hand. No system path ever mails the typed address (C5 stands). |
| FC2 (social engineering) | **F383** | Accepted: runbook plus the inbox label. No code authority flows from a message. |
| FC3 (kill switch) | **F384** | CA6. Premise corrected by AF-3. |
| FC4 (coalescing, recipients) | **F385** | CA3 and CA4, DECISION-301. |
| FC5 (audit flood) | **F386** | CA5, DECISION-302. |
| FC6 (retention) | **F387** | CA1 columns, CA11. |
| FC7 (honeypot loss) | **F388** | Accepted as the analyst wrote it. Use the DECISION-083 `_hp` naming pattern with the accessibility handling Phase 1 listed. |
| FC8 (input boundaries) | **F389** | CA12. |
| FC9 (unavailable dead end) | **F390** | Accepted. The unavailable state and the "check didn't load" state share one exit block. |
| FC10 (help edit size) | **F391** | Accepted (Phase 3 Copy). |

**Architect findings (numbers to assign):**

- **AF-1. C1's INSERT-only option has no precedent on the live catalog, and RETURNING would fail.**
  - `aclexplode(relacl)` for `presby_app` on `pipeline-help-contact` shows these grant shapes: full DML; INSERT plus SELECT (`audit_events`, `tickets`, `roll_actions` and others); INSERT, SELECT and UPDATE; SELECT only; SELECT and UPDATE; DELETE and SELECT. **Never INSERT alone.**
  - The anonymous and credential paths are definer-mediated:
    - `account_invitations` has no `presby_app` privilege at all; `presby_platform` holds SELECT. It is reached through `presby_preview_invitation` and `presby_accept_invitation`.
    - `giving_checkout_intents` is SELECT-only for `presby_app` and is written by `presby_giving_create_intent_public`.
    - All are owned by `neondb_owner`, pin `search_path = public, pg_temp`, and are revoked from PUBLIC.
  - Drizzle's `.returning()` needs SELECT. Resolved by CA1.
- **AF-2. `getRequestIp` trusts a header that Vercel is not documented to strip.**
  - What the code assumes: `src/lib/request-ip.ts` returns `cf-connecting-ip` unconditionally. DECISION-017's reason is "Vercel strips unrecognized headers".
  - What is proven: Vercel's request-headers documentation says it **overwrites** `x-forwarded-for`, and that `x-real-ip` and `x-vercel-forwarded-for` are identical to it, "to prevent IP spoofing". It says nothing about stripping other client headers.
  - What the deployment looks like: `docs/deployment.md` and `docs/architecture.md` do not mention Cloudflare fronting, so the deployment is direct to Vercel.
  - What is not proven, and must be verified on a deployment: that a client-sent `cf-connecting-ip` is dropped. Protocol: on a preview deployment, send four forgot-password requests carrying `cf-connecting-ip: cf-probe-1`, then read the `RATE_LIMIT_BLOCKED` row's `resource_id`. If it reads `pwreset_req:cf-probe-1`, the header passes through and every per-IP key in the app is chosen by the client. The callers are `src/auth.ts`, `(password-reset)`, `(invite)`, `(statistics-submit)`, the site contact action and give.
  - Severity: sign-in stays bounded by Turnstile and the per-account lockout (`src/auth.ts` steps 5 and 5b, which do not use the IP). The rest lose only their per-IP courtesy limit.
  - **Not fixed here.** The likely fix gates the `cf-` branch behind an explicit opt-in, like `TRUST_PROXY_HEADERS`, and amends DECISION-017. That changes the sign-in limiter's key, so it is its own bug-fix pipeline with the MFA e2e smoke. It needs a TODO line at integration.
  - For this form: per-IP is a courtesy, and the bound is Turnstile plus the global ceiling plus the database backstop (CA5).
- **AF-3. FC3's "immediate kill switch" is false on Vercel.**
  - Vercel: "Any change you make to environment variables are not applied to previous deployments, they only apply to new deployments."
  - Build and runtime environment are one snapshot per deployment, so the "page built with keys, action without" split cannot happen inside one Vercel deployment. Removing variables takes effect at the next deployment, which also rebuilds the page as unavailable.
  - The action's own configured-check is **still required** (CA6). Otherwise `verifyTurnstile`'s unconfigured no-op could become this form's posture, it keeps a fork or self-hosted runtime honest, and it makes the page and the action agree by construction.
  - The immediate levers are in CA6.
- **AF-4. Timing oracle.** If the Resend call ran inline only on the submission that claims the notification slot, a sender could tell from latency whether someone else wrote in the last window. Resolved: the provider attempt runs in `after()` (CA4).
- **AF-5. Clearing must not survive in the audit log.** An audit row for "clear details" whose `metadata` copied the name, email or message would defeat the clear, because `audit_events` is kept forever (privacy policy line 79). Resolved by CA10.
- **AF-6. H19's exemption is the whole `help/contact/` subtree.** `EXEMPT = ["src/app/(documentation)/help/contact/"]` in `scripts/lib/help-boundary.mjs` also exempts the page and the client island, which are exactly what should stay checked. The walker (`scripts/lib/import-graph.mjs` `checkImportBoundary`) has no stop rule either. Narrowing to `actions.ts` alone would still fail through the island-to-action import. Resolved by CA9.
- **AF-7. C6's reliance on `check:audit` is `paper` here.** `MUTATION_RE` (`/\bdb\s*\.\s*(insert|update|delete|execute)\b/`) cannot see `getPlatformDb().update(...)` or a write that lives in a library file. Resolved by CA10's test.
- **AF-8. Normalizer drift.**
  - `src/lib/careers/text.ts` already has `normalizeMultiline`, `cleanText` and `charCount` (NFC, controls, bidi, zero-width, code-point length).
  - `src/lib/onboarding/input.ts` `normalizePersonName` is a weaker second copy: it does not strip zero-width characters and counts UTF-16 length.
  - A third copy would add drift. Resolved by CA12. The onboarding copy is a follow-up, not this pipeline.

#### Contact-addendum rulings (CA1–CA13), binding on Phase 3

**CA1. The write is definer-only (handoff item 1). This amends C1.**
- `0083` creates `help_contact_messages`.
- **Columns:**
  - `id` uuid primary key.
  - `created_at` timestamptz, default `now()`.
  - `topic` text, CHECK in a closed list of four machine keys.
  - `name`, `email` and `congregation`: nullable text.
  - `message`: text.
  - `status` text, default `'new'`, CHECK in `('new','handled','spam')`.
  - `status_changed_at`, plus `status_changed_by` referencing `users(id)`.
  - `notified_at`: nullable timestamptz.
  - `cleared_at`, plus `cleared_by` referencing `users(id)`.
  - Optional `submission_id` uuid, with a unique partial index, if Phase 3 adopts the idempotency key from Phase 1 Note 1. That choice is Phase 3's.
- **What the table never holds:** an IP, a user agent, an `organization_id`, a person id or a user id for the sender (FC6, C2, C4).
- **CHECKs repeat the server bounds:**
  - `char_length` limits.
  - A message that is not blank after `btrim`.
  - The cleared shape: once `cleared_at` is set, name, email, congregation and message are null. Until then, message and email are not null.
- **Indexes:** `(status, created_at desc)` for the inbox and the card; `(created_at)` for the backstop count; a partial index on `created_at where notified_at is not null`.
- **Grants:**
  - `revoke all on help_contact_messages from public, presby_app, presby_platform;` and **grant nothing**. `presby_platform` cannot log in, and `src/lib/db/index.ts` records that it is unused.
  - Enable and force RLS with no policy.
- **Guards:**
  - A `BEFORE DELETE` guard that always raises.
  - A `BEFORE UPDATE` guard:
    - `id`, `created_at`, `topic`, `notified_at` and `submission_id` cannot change.
    - The four personal fields can change only to null, and only in the same update that sets `cleared_at`.
    - `cleared_at` never goes back to null.
    - Optionally, clearing only when `status <> 'new'`; Phase 3's choice.
    - The operator can triage and clear. The operator can never rewrite a stranger's words.
- **The one write path:** `presby_submit_help_contact(p_topic text, p_name text, p_email text, p_congregation text, p_message text[, p_submission_id uuid])`:
  - `SECURITY DEFINER`, `set search_path = public, pg_temp`.
  - `revoke all … from public`, then `grant execute … to presby_app` only.
  - It returns **only a closed outcome token**: `'stored'`, `'stored_notify'` or `'ceiling'`. No id and no content.
  - **What the design gets back is that token and nothing else.** There is no reference number, so the success copy shows none (Phase 1 Note 1 stands).
- **Reads and triage writes** happen only in `src/lib/help-contact/inbox.ts` through `getPlatformDb()`.
- **Database tests** go in a pipeline test file such as `src/lib/db/domain/help-contact.db.test.ts`, not in the Rule 16 shared `scripts/test-rls.sql` (that file gets its assertions at integration). They prove:
  - As `presby_app`: SELECT, INSERT, UPDATE and DELETE on the table each fail with 42501.
  - EXECUTE succeeds for `presby_app`, and `has_function_privilege('public', …)` is false.
  - The DELETE guard fires for the owner.
  - The UPDATE guard refuses a rewrite and an un-clear.
- **Phase 5 re-reads the live catalog** on the branch after `0083` is applied: `relforcerowsecurity`, `pg_policies` (zero rows), `aclexplode(relacl)` (no `presby_app` and no PUBLIC), `pg_trigger` and `proacl`.

**CA2. Order of checks in the action. This amends C3's order.**
1. Platform host (CA7).
2. Configured (CA6).
3. Honeypot: a silent fake success that spends nothing.
4. Server-side validation (CA12). It runs **before** Turnstile, so a field error does not burn the single-use token.
5. Per-IP limit, only when an IP exists (CA8).
6. `verifyTurnstile(token, ip)`.
7. The global ceiling. It runs **after** Turnstile, so a flood without tokens can never spend the honest senders' budget.
8. The definer call, which holds the database backstop.

**CA3. Coalescing lives in the definer (handoff item 2). DECISION-301.**
- Inside the function:
  - Take `pg_advisory_xact_lock(<constant>)`.
  - Set `notified_at = now()` on the new row only if no row has `notified_at > now() - <window>`.
  - Return `'stored_notify'` when this row took the slot.
- Why this mechanism:
  - It is one statement, exact across serverless instances, and works in development without Upstash.
  - It needs no read privilege for the caller, no second table and no cron.
  - "Last notified" is a column on the message, not a singleton row.
  - "First message after a quiet hour" was rejected: a steady trickle would suppress every later notification.
- Constants:
  - The window is a constant in SQL, never a parameter. Suggested: 60 minutes.
  - The **database backstop ceiling** in the same function also returns `'ceiling'`. Suggested: a daily count set above the limiter's daily ceiling, so it bites only if the limiter is misconfigured or in memory.
- **No fifth cron.** The four in `vercel.json` stand.

**CA4. Recipients and sending. This amends C5's recipient set.**
- Recipients come from `getTicketOperatorPool()` in `src/lib/tickets-notifications.ts`, the single definition of "holders of `ADMIN_TICKETS`". On the live catalog, `admin` and `support_operator` both carry `admin.tickets` in `role_features`. It replaces the `ADMIN_ROLE` join in the `feedback_notification` precedent.
- The email has a constant, content-free subject and body, with a button to `/admin/messages` built from `platformOrigin()`. It is rendered through `renderEmail`.
- Sequence:
  - The definer call commits the message.
  - If the outcome is `'stored_notify'`, the action inserts one queue row per recipient with `insertQueueRowInTx(db, …)` **before responding**.
  - **Only the provider attempt** runs in `after(() => attemptQueuedSend(id))`. The 5-minute `/api/cron/email-queue` is the durable backstop (the `src/lib/onboarding/issue.ts` precedent).
  - Do not use `enqueueEmail()`, which sends inline (AF-4). Do not put the whole step in `after()`: a cut-off would spend the slot with nothing queued.
- Enqueue failures are caught and logged and never fail the submission. **Accepted residual:** a failed enqueue loses that window's notification. The dashboard "Messages" card is the backstop.
- A test asserts that no queue row's `to_email` ever equals the typed address (C9).
- Follow-up, not this pipeline: `getTicketOperatorPool()` does not filter `users.is_active`. That affects tickets too.

**CA5. Limiter audit bound (handoff item 3). DECISION-302.**
- Split `src/lib/rate-limit.ts`:
  - `consumeRateLimit(key, limit)`: the check, honouring `RATE_LIMIT_DISABLED`, with no audit.
  - `recordRateLimitBlock(key, context, retryAfterSeconds)`: the existing direct `audit_events` insert. It sets no `ip` column; the IP appears only if it is in the key.
  - `checkRateLimit`: their composition, **with signature and behaviour unchanged**. Its existing tests pass unedited, which is the guard for the other callers.
- The contact form:
  - Calls `consumeRateLimit` for `help_contact:ip:<ip>` and `help_contact:global`. The keys hold the IP only, never typed text (C4).
  - On any refusal (per-IP, global or database `'ceiling'`), writes at most **one** `recordRateLimitBlock("help_contact:<kind>", { userId: null, actor: "anonymous", reason: "help_contact_form" }, …)` per kind per window. The gate for that is `consumeRateLimit("help_contact:audit:<kind>", { max: 1, windowSeconds: 3600 })`.
  - That bounds the audit write to a few rows an hour, and those rows carry no IP. The privacy policy (lines 46–47) already covers IP-counted abuse protection, so the copy stays true.
- Use `recordRateLimitBlock`, not `recordAudit`. `recordAudit` imports `@/auth` and calls `auth()` when the actor is undefined.
- An Upstash error fails closed as "not sent".

**CA6. Configured-check and kill switch (handoff item 5). This amends C10. DECISION-303.**
- `isHelpContactConfigured(env)` lives in `src/lib/help-contact/configured.ts`. It is pure and reuses `isProductionDeployment` from `src/lib/domains/host.ts`.
- It requires:
  - `TURNSTILE_SECRET_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in **every** environment. Development and e2e use Cloudflare's public test keys.
  - In a production deployment, also both Upstash variables, and `RATE_LIMIT_DISABLED !== "true"`.
- Where it runs:
  - The page calls it at build and renders the static unavailable state.
  - The action calls it at runtime and returns the outcome `'unavailable'`. The island renders the same unavailable component for that outcome.
- C10 restated:
  - **Durable kill switch:** remove the variables and **redeploy**.
  - **Immediate lever A, verifiable now:** `revoke execute on function presby_submit_help_contact(...) from presby_app`, an operator SQL step in the runbook. The action maps SQLSTATE 42501 to `'unavailable'`, not "not sent", and a database test pins that.
  - **Immediate lever B, unverified:** remove the production host from the Turnstile widget's allowed hostnames in Cloudflare. The widget then errors client-side, the island shows its exit, and no token can be minted. This must be walked before the runbook states it.
- The fail-open on a Cloudflare outage (DECISION-026) stays. The global ceiling plus the database backstop bound it, and that is accepted.

**CA7. Custom host (handoff item 9).**
- The action refuses with `'unavailable'` unless `isPlatformHost(requestHost(await headers()))`.
- A unit test covers a custom host, an IP literal and a missing host.
- The e2e POSTs the action (`Next-Action` header) to a custom host and asserts no row and no distinguishing response. It joins the existing `/help/contact` line in `e2e/custom-domains/lockdown.spec.ts`.

**CA8. The no-IP case (handoff item 4).** When `getRequestIp` returns null, the per-IP check is **skipped**. The request counts only against the global ceiling and the database backstop. There is no shared `unknown` bucket. On Vercel, `x-real-ip` is always set, so null means development or tests.

**CA9. H19 and `shell-boundaries` carve-out (handoff item 6). DECISION-304.**
- In `scripts/lib/import-graph.mjs`:
  - `checkImportBoundary` gains an optional `stopAt: string[]`, default empty, so `check:proxy-imports` is unchanged.
  - A stop file counts as reached, but its imports are not followed.
- In `scripts/lib/help-boundary.mjs`:
  - `EXEMPT` (the subtree) is **removed**.
  - It is replaced by `SERVER_ACTION_STOPS = ["src/app/(documentation)/help/contact/actions.ts"]`, exactly one file. `page.tsx` and `contact-form.tsx` stay H19 entries and are walked, and so is everything they import, including `src/lib/help-contact/contract.ts`, which must therefore be pure.
  - Two new H19 violations: the stop file's first statement is not `"use server"`; or the stop file is reached from an entry outside `src/app/(documentation)/help/contact/`.
  - Fixtures for both go in `scripts/lib/help-boundary.test.mjs`.
- In `src/app/(documentation)/shell-boundaries.test.ts`:
  - `ownedSources()` excludes exactly that one path, held in a named constant.
  - A new dedicated test pins `actions.ts`:
    - It begins with `"use server"`.
    - Its imports are a subset of `next/headers`, `next/server`, `@/lib/help-contact/*` and `@/types/actions`.
    - It has no `auth()`, `cookies()`, `searchParams`, `getPlatformDb` or `@/auth`.
  - The `dynamic = "error"` page count goes from 4 to 5, and the expected-routes list gains `help/contact/page.tsx`.
  - The `loading.tsx` and `error.tsx` bans keep **no** carve-out.
- In `src/lib/help-contact/`, a boundary test:
  - The graph reached from `actions.ts` never calls `getPlatformDb(`. The definition in `src/lib/db/index.ts` is excepted.
  - `inbox.ts` is never imported under `src/app/(documentation)/**`.

**CA10. Triage audit.**
- The status change and the clear each run in `inbox.ts` as one transaction: the UPDATE plus `insertAuditRow(tx, …)` from `src/lib/audit-tx.ts`.
- `metadata` holds the message id and the from and to status only. **It never holds the name, email, congregation or message** (AF-5).
- A database test asserts one audit row per mutation and no personal-field content in `metadata`. That test replaces `check:audit` as the guard (AF-7). The admin `actions.ts` still imports and uses `AUDIT_ACTIONS` keys.

**CA11. Retention (handoff item 10).**
- The CA1 columns match FC6: no IP and no user agent on the row.
- The refusal audit rows carry no IP (CA5). The triage audit rows record the operator's request metadata, as every audit row does.
- No sweep in this increment. The privacy policy states no period (Q4 default).

**CA12. Input normalization (handoff item 10).**
- Lift `src/lib/careers/text.ts` to a pure `src/lib/text-hygiene.ts`. `careers/text.ts` re-exports it, so its five importers do not change (the R8 pure-sibling pattern).
- `validate.ts` applies:
  - `cleanText` to name, congregation and email.
  - `normalizeMultiline` plus `btrim` to the message.
  - `charCount` for every length.
  - Email checked for shape only, with no MX lookup. Not lowercased: it is shown as typed.
  - Topic from the closed list.
- Overlong input is rejected, never truncated. Postgres CHECKs repeat the bounds.

**CA13. Not proven from source; Phase 5 must prove it on the production lane (`test:e2e:prod`, `next build && next start`).**
- A Server Action in a `dynamic = "error"` segment can call `headers()` and `after()` at request time.
- Prove it with a submission that writes a row and derives the per-IP key from a request carrying `x-real-ip`.
- If it fails, loop back to Phase 2. Do not quietly switch the segment to `force-static`: that could make `headers()` empty and silently remove the per-IP limit.

#### Other notes for Phase 3

- **Sign-in path regression check.** The `rate-limit.ts` split touches a module `src/auth.ts` calls. It is not formally auth-touching, but QA should run the existing sign-in e2e as a regression check.
- **Inbox rendering.** Every field renders as plain text in an isolated `whitespace-pre-wrap break-words` container (C8 plus FC8). Nothing is auto-linked. The typed address is labelled as unverified (FC2).
- **Rule 16.** These files are edited at integration only: `src/lib/db/domain/index.ts`, `drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `docs/decisions.md`, `docs/TODO.md` (including the AF-2 line and the onboarding-normalizer and `is_active` follow-ups), and any `e2e/support/*` helper.

#### Proposed decisions (the orchestrator records them)

- **DECISION-300.** The help contact form writes to a definer-only platform-axis table, `help_contact_messages` (migration 0083).
  - `presby_app` holds no table privilege and reaches it only through `presby_submit_help_contact(...)`. That function is `SECURITY DEFINER`, revoked from PUBLIC, executable by `presby_app` only, and returns only a closed outcome token: no id, no content.
  - FORCE RLS with no policy, as a deny-all.
  - DELETE is revoked, and a `BEFORE DELETE` guard covers the owner.
  - A `BEFORE UPDATE` guard allows status changes and an irreversible clear only.
  - Reads and triage happen only in `src/lib/help-contact/inbox.ts` through `getPlatformDb()`.
  - No IP, user agent, organization, person or sender id is stored.
  - Amends C1 of the user-help parent (not `schema.ts`; no INSERT-only grant), because the catalog has no INSERT-only precedent and `RETURNING` needs SELECT.
- **DECISION-301.** Notification coalescing is claimed inside the definer: `notified_at` on the message row, under a transaction advisory lock, with a SQL-constant window.
  - Recipients are the holders of `FEATURES.ADMIN_TICKETS`, through `getTicketOperatorPool()`.
  - The content-free queue row is inserted before the response. Only the provider attempt runs in `after()`. The existing 5-minute email-queue cron is the durable backstop.
  - No fifth cron. Template `help_contact_notification` is classified `account`.
  - Accepted residual: a failed enqueue loses that window's notification; the dashboard card is the backstop.
- **DECISION-302.** `src/lib/rate-limit.ts` exposes `consumeRateLimit` (no audit) and `recordRateLimitBlock`. `checkRateLimit` is their unchanged composition.
  - The contact form audits limiter refusals at most once per kind per window, with keys that carry the IP only (or nothing).
  - It skips the per-IP check when no IP is known.
  - It places the global ceiling after Turnstile.
  - It backs the limiter with a database ceiling inside the definer.
  - Because `cf-connecting-ip` is unverified on Vercel, the per-IP limit is a courtesy.
- **DECISION-303.** The form's availability is a pure configured-check (Turnstile keys everywhere; also Upstash and the limiter enabled in a production deployment), evaluated by the page at build and by the action at runtime.
  - The action also refuses on any host outside the platform set.
  - On Vercel, removing variables takes effect only at the next deployment. The immediate lever is revoking EXECUTE on the definer function, which the action maps to "unavailable".
  - Amends C10's "immediate" claim.
- **DECISION-304.** The public documentation boundary's one database-reaching file is `src/app/(documentation)/help/contact/actions.ts`, named exactly.
  - It is a `'use server'` stop in H19's import walk: reached but not followed, required to begin with `"use server"`, and reachable only from its own segment.
  - The page and the client island remain H19 entries.
  - `shell-boundaries.test.ts` pins the file's import allow-list.
  - Replaces the subtree exemption recorded in DECISION-293's R8.

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete (addendum: CA1–CA13; amends C1, C3 order, C5 recipients, C6 enforcement, C10, R9; FC1–FC10 → F382–F391; AF-1–AF-8 need numbers past the block; DECISION-300–304 proposed) | Approved with suggestions | 2026-10-31 |

### Handoff

**Next: tech-lead (Phase 3).** The design's Carry-forward table must honour:

- **CA1–CA13** in full, and **C2, C4, C7, C8 and C9** as written in the parent.
- **The amendments:**
  - C1: domain file and definer-only.
  - C3: the check order in CA2.
  - C5: `ADMIN_TICKETS` recipients.
  - C6: enforced by a database test, not by `check:audit`.
  - C10: redeploy, plus the EXECUTE-revoke lever.
  - R9: no `error.tsx`.
- **The production-lane proof in CA13,** stated as an Edge Case with its test named.
- **A Copy table** that claims nothing AF-3 or AF-2 disproves:
  - No "instant" shutdown.
  - No promise about IP-based protection.
  - The privacy-policy sentences say the message is stored without IP or browser details, which is true, and do not say "we never record your IP", which the refusal and triage audit rows would contradict.
- **The implementer.** I would split it: database-admin for `0083` and its database tests, then full-stack-developer for the rest. The tech-lead names the implementer.
- **Operator runbook text:** FC2, FC9's ship order, CA6's levers, and "test keys never in Production".

**The orchestrator, at integration:**
- Assigns F-numbers to AF-1–AF-8.
- Opens a TODO line for AF-2 as its own bug-fix pipeline, gated on the preview-deployment verification protocol above.
- Opens follow-up lines for the onboarding normalizer (AF-8) and `getTicketOperatorPool()`'s missing `is_active` filter.
- Takes the CLAUDE.md Project Layout line and the `architect.md` route-group sentence to the operator.

**Files read:**
- `/Users/cshenso/git/presby-platform/presby-help-contact/CLAUDE.md` (via context)
- `/Users/cshenso/git/presby-platform/presby-help-contact/docs/work-log/2026-10-31-help-contact.md`
- `/Users/cshenso/git/presby-platform/presby-help-contact/docs/work-log/2026-10-26-user-help.md` (Phase 2, lines 560–851)
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/request-ip.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/rate-limit.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/turnstile.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/app/(public)/site/[slug]/actions.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/docs/decisions.md` (DECISION-017, DECISION-083)
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/tickets-notifications.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/app/(member)/feedback/actions.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/email/queue.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/db/schema.ts` (`email_queue`)
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/db/index.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/db/domain/invitations.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/drizzle.config.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/drizzle/0059_presby_account_invitations.sql` (grant and guard lines)
- `/Users/cshenso/git/presby-platform/presby-help-contact/vercel.json`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/proxy.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/domains/host.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/e2e/custom-domains/lockdown.spec.ts` (line 125)
- `/Users/cshenso/git/presby-platform/presby-help-contact/scripts/lib/help-boundary.mjs`
- `/Users/cshenso/git/presby-platform/presby-help-contact/scripts/lib/import-graph.mjs`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/app/(documentation)/shell-boundaries.test.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/help/checks.ts` (`RESERVED`)
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/admin-portal/nav.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/admin-portal/dashboard/boundaries.test.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/admin-portal/dashboard/feedback.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/scripts/check-audit-coverage.mjs`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/audit.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/audit-tx.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/contact-methods/email-audience.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/careers/text.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/onboarding/input.ts`
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/auth.ts` (lines 95–160)
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/content/help/privacy-policy.md` (IP and audit lines)
- `/Users/cshenso/git/presby-platform/presby-help-contact/docs/ui-standards.md` (`error.tsx` rules)
- `/Users/cshenso/git/presby-platform/presby-help-contact/src/lib/permissions.ts` (`hasFeature`, `ADMIN_ROLE`)
- Live catalog on `pipeline-help-contact`: `aclexplode(relacl)` for `presby_app` on all public tables; tables with no `presby_app` grant; `pg_policies`; `pg_trigger`; definer functions with owner and EXECUTE privilege; `pg_roles` (BYPASSRLS); `role_features` rows for `admin.tickets`.

Sources:
- [Vercel: Request headers](https://vercel.com/docs/headers/request-headers)
- [Vercel: Environment variables](https://vercel.com/docs/environment-variables)
- Search (inconclusive on Vercel and `cf-connecting-ip`): [ipgeolocation.io guide](https://ipgeolocation.io/guides/get-real-client-ip-address.md), [hono-ip README](https://cdn.jsdelivr.net/npm/hono-ip@2.0.2/README.md), [stackharbor: real client IP at origin](https://stackharbor.com/en/knowledge-base/cfops-real-client-ip-at-origin/)

---

# Phase 3 — Technical Design (tech-lead)

**Pipeline:** `2026-10-31-help-contact` · **Worktree:** `/Users/cshenso/git/presby-platform/presby-help-contact` (HEAD `7c8a264`, main 0.50.1) · **Date:** 2026-10-31 · Read-only against the live tree; no code and no Rule 16 file was edited. No real name, address or email appears here (examples use `example.invalid`).

**Operator rulings (2026-10-31), binding:** Phase 1 Q1–Q11 defaults stand. The operator replies by hand and the system never mails the typed address (Q1); email is required (Q2); a locked-out administrator may use the form but a message is never authority (Q3); "Clear details", no sweep (Q4); statuses `new` / `handled` / `spam` plus a dashboard card (Q5); limits 3 per hour per IP, global 30 per hour and 100 per day, message 2,000 characters (Q6); the operator sets the Turnstile and Upstash variables in Production before merge (Q7); the marketing home page is left alone (Q8); `ADMIN_TICKETS` (Q9); fail-open on a Cloudflare outage (Q10); four topics (Q11).

## Summary

An anonymous visitor writes a short message at `/help/contact`. A static server-component page carries a client island (fields, honeypot, Turnstile). The island calls one thin Server Action. The action refuses off the platform host and when unconfigured, then validates, rate-limits, verifies Turnstile, and calls one `SECURITY DEFINER` function that writes a row to a new platform-axis table, `help_contact_messages` (migration `0083`). `presby_app` holds no privilege on the table and reaches it only through that function, which also coalesces the operator notification (one per 60 minutes, under an advisory lock) and enforces a database ceiling. The notification is a content-free email to the holders of `FEATURES.ADMIN_TICKETS`, queued before the response and sent in `after()`. The operator reads, triages and clears messages at `/admin/messages` (card list at 360px, plain text only), replies by hand from their own mailbox, and never acts on a message alone. The 13 `{{contact}}` sentences on 11 help pages stop dead-ending at "ask the person who invited you": members get the form, administrators get the ticket route and the form. No flag, no new environment variable, no new dependency, `src/proxy.ts` untouched (so the pipeline is not auth-touching by the Phase 4 gate; the `rate-limit.ts` split is on the sign-in path, so QA reruns the sign-in e2e as a regression check).

## Feasibility check (against the live tree, 2026-10-31)

- **Function signature.** `presby_submit_help_contact(p_topic text, p_name text, p_email text, p_congregation text, p_message text) returns text`: five required parameters, no defaults, so no trailing-default ordering problem. The architect's optional `p_submission_id` is dropped (see Data Model, "Idempotency key").
- **ALTER/DROP on shared objects.** None. Only new objects: one table, three guard functions, one definer, indexes, comments. No `SECURITY DEFINER` body references a changed object. `rate-limit.ts` is TypeScript-only.
- **CHECKs and triggers against fixtures.** The table is new, so no shipped fixture (`scripts/seed-dev.sql`, e2e fixtures) inserts into it. Every future owner-path insert (the admin e2e's seeding, DB tests) must satisfy the CHECKs: message at least 10 characters after `btrim`, a topic from the closed list, an email with the shape CHECK. Stated in the test plan so the implementer builds fixtures to it.
- **FKs.** `status_changed_by` and `cleared_by` reference `users(id)`: `users` is a platform-axis table with a plain `id` primary key and no tenant column, so there is no composite-tenant-key question (the table has no `organization_id` by design: C2, C4). Users are never hard-deleted (all deletes are soft), so `ON DELETE` stays at the default.
- **Advisory lock.** `0057` and `0071` use `pg_advisory_xact_lock(hashtextextended('<name>:' || …, 0))`. The new function uses `hashtextextended('help_contact_messages', 0)`, which cannot collide with those keys.
- **Link resolver.** `src/lib/help/links.ts` `resolveLink("/help/contact")` currently returns `null` (the slug regex matches `contact`, which is `RESERVED`, so it is in no published map). `FIXED_INTERNAL` must gain `"/help/contact"` or H6 fails on every page that uses the new line.
- **H19 entry list.** With `EXEMPT` removed, `help/contact/actions.ts` would itself become a walk entry and fail on `next/headers`. `helpBoundaryEntries` must skip the stop file (CA9 detail below).
- **Needs block.** `src/components/help/needs-block.tsx` is a 14th reader of the contact line (through `switchedOnText`, for a page whose entry sets `needs.operatorEnabled`). No registry entry sets it today (grep: none), so it is latent, but it renders the line as plain text in a `<dd>`, where a markdown link would show raw brackets. It is handled below.
- **Turnstile site-wide.** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is read by `signin-credentials-form.tsx:12`, `forgot-password/page.tsx:12` and `give-form.tsx:58`, which disable submit until a token exists, and `verifyTurnstile` is called from `src/auth.ts`, the sign-in action, forgot-password and the give actions. Setting the Production variables therefore also turns the check on at those three forms. This does not block the design; it changes the runbook, the e2e shape (below) and gives the operator a question.
- **E2E consequence of the same fact.** Setting the Turnstile keys on the shared e2e server would disable the sign-in form's submit for every existing spec and for `globalSetup`'s own sign-ins. So the live-form specs cannot share the default dev server. They get their own invocation (`PW_HELP_CONTACT=1`, own server, own port, no sign-in). Specs that need an admin session and no keys run in the ordinary lane against owner-seeded rows.
- **Phase 4 sequencing.** Four other help-tokened TODO lines edit pages this design touches (`founder-events-branding`: `first-day-as-administrator`, `roles-who-can-do-what`, `events-and-the-calendar`, `your-congregations-website`; `phone-public-listing`: `your-congregations-website`; `reimbursements`: `reimbursements-for-treasurers`; `email-change-error`). The contact edits to those pages are one-token swaps, kept minimal so integration conflicts are mechanical.

## Permissions & Flags

- **Permission key:** none new. The inbox, the nav item, the dashboard card and the notification recipients all use the existing `FEATURES.ADMIN_TICKETS` (`admin.tickets`). `src/lib/permissions.ts` stays frozen.
- **Default role bindings (live catalog, Phase 2):** `admin` and `support_operator` both carry `admin.tickets`. They are the people who see the inbox and get the email. No seed change.
- **Anonymous form:** no permission and no session. The action never calls `auth()`. A signed-in sender is anonymous to it.
- **Flag:** not needed (operator: no new platform flags pre-live; C10). The two real gates are the pure configured-check (below) and the ship order in the runbook.
- **Environment:** no new variable. Existing: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`; read: `RATE_LIMIT_DISABLED`, `VERCEL_ENV`.
- **e2e flags:** no new or changed spec depends on a feature flag, so nothing goes into `scripts/ci/e2e-baseline-flags.sql` and nothing calls `e2e/support/flags.ts`. The e2e person-id range `00000000-0000-4083-` is unused (no person fixture).

## API Contract

### The public action (the only export of `src/app/(documentation)/help/contact/actions.ts`)

```ts
"use server";
export async function submitHelpContactAction(formData: FormData): Promise<HelpContactOutcome>;
```

`actions.ts` is thin: it reads `await headers()` and calls `submitHelpContact(formData, hdrs)` in `src/lib/help-contact/submit.ts`. A test pins that the file exports exactly one function (every export of a `'use server'` file is a public endpoint).

Form fields (names in `contract.ts`): `topic`, `name`, `email`, `congregation`, `message`, `_hp` (the honeypot, the DECISION-083 name), `turnstileToken`. The client never supplies a status, a timestamp or an id.

```ts
// src/lib/help-contact/contract.ts (pure, client-safe, zero server imports)
export type HelpContactTopic = "starting_a_congregation" | "signing_in" | "help_page_wrong" | "something_else";
export type HelpContactField = "topic" | "name" | "email" | "congregation" | "message";
export type FieldCode = "required" | "too_short" | "too_long" | "bad_format";
export type HelpContactOutcome =
  | { kind: "sent" }
  | { kind: "invalid"; fieldErrors: Partial<Record<HelpContactField, FieldCode>> }
  | { kind: "check_failed" }   // Turnstile refused the token
  | { kind: "busy" }           // per-IP, global or database ceiling: one neutral state
  | { kind: "not_sent" }       // database, limiter or unexpected error
  | { kind: "unavailable" };   // custom host, unconfigured, or EXECUTE revoked
export const HELP_CONTACT_LIMITS = { name: 100, congregation: 150, email: 254, messageMin: 10, messageMax: 2000 } as const;
```

**Order of checks (CA2, binding).** `submitHelpContact` runs, in this order, and each step returns before the next spends anything:

1. Platform host: `requestHost(hdrs)` is non-null and `isPlatformHost(...)`; else `unavailable` (CA7). No limiter, no database.
2. Configured: `isHelpContactConfigured(process.env)`; else `unavailable` (CA6).
3. Honeypot: `_hp` non-blank after trim returns `{ kind: "sent" }` and spends nothing (C3, F388).
4. Validation (below, CA12): any failure returns `invalid` before Turnstile, so a field error does not burn the single-use token.
5. Per-IP limit, only when a usable IP exists (CA8): `consumeRateLimit("help_contact:ip:<ip>", { max: 3, windowSeconds: 3600 })`. Refusal returns `busy` after one bounded audit write (CA5).
6. `verifyTurnstile(token, ip)`: false returns `check_failed`.
7. Global ceiling, after Turnstile: `consumeRateLimit("help_contact:global:hour", { max: 30, windowSeconds: 3600 })` then `consumeRateLimit("help_contact:global:day", { max: 100, windowSeconds: 86400 })`. Refusal returns `busy` after one bounded audit write.
8. The definer call. `'ceiling'` returns `busy` (one bounded audit write). `'stored'` returns `sent`. `'stored_notify'` runs the notification (below), then returns `sent`.

**The usable-IP rule (AF-2, F407).** `getRequestIp` trusts `cf-connecting-ip` unconditionally and Vercel is not documented to strip it, so the value is client-influenced. `submit.ts` uses the IP only if it matches `/^[0-9a-fA-F:.]{2,45}$/`; anything else is treated as "no IP" (the per-IP check is skipped; the global ceiling and the database ceiling still bind). This also stops a spoofed header from injecting an arbitrary string into a limiter key. The per-IP limit is a courtesy; the bound is Turnstile plus the global ceiling plus the database ceiling.

**Errors.** An Upstash or other limiter throw returns `not_sent` (fail closed). A definer error with SQLSTATE `42501` (EXECUTE revoked, the operator's immediate lever) returns `unavailable`. Any other error returns `not_sent` and logs only the error class (never the message, name, email or congregation).

**Validation (`validate.ts`, pure, CA12).** Imports the lifted `src/lib/text-hygiene.ts`.

| Field | Rule |
|---|---|
| `topic` | one of the four keys; else `required` |
| `name` | `cleanText`; blank becomes null; at most 100 characters (`charCount`); else `too_long` |
| `email` | `cleanText` (not lower-cased, shown as typed); required; at most 254; shape only: exactly one `@`, non-empty local part, a domain containing a dot, no whitespace; no MX or deliverability lookup; else `required` / `too_long` / `bad_format` |
| `congregation` | as `name`, at most 150 |
| `message` | `normalizeMultiline` then trim; required; at least 10 and at most 2,000 characters; else `too_short` / `too_long` |

Overlong input is rejected, never truncated. Controls (NUL included), bidirectional overrides and zero-width characters are stripped on save, NFC applied. The Postgres CHECKs repeat the bounds.

### The definer (migration 0083)

```sql
presby_submit_help_contact(p_topic text, p_name text, p_email text, p_congregation text, p_message text) returns text
```

`SECURITY DEFINER`, `set search_path = public, pg_temp`, owned by `neondb_owner`. EXECUTE revoked from `public`, `presby_app` and `presby_platform`, then granted to `presby_app` only. Outcome tokens, closed: `'stored'`, `'stored_notify'`, `'ceiling'`. It returns no id and no content, so the success copy shows no reference number.

### Notification (`notify.ts`, `server-only`)

On `'stored_notify'` the action, before responding: `getTicketOperatorPool()` (the single definition of "holders of `ADMIN_TICKETS`"), then one `insertQueueRowInTx(tx, …)` per operator in one transaction on `db`, template key `help_contact_notification`, with a constant content-free message (Copy section E). Only the provider attempt runs in `after(() => attemptQueuedSend(id))`, each in its own try/catch; the 5-minute `/api/cron/email-queue` is the durable backstop. Not `enqueueEmail()` (it sends inline: AF-4 timing oracle). Any failure is caught, logged by error class, and never fails the submission. Accepted residual: a failed enqueue loses that window's notification; the dashboard card is the backstop. Recipients: when the pool is empty, `console.warn` and skip. The queue row's `to` is always an operator's account address; the typed address is not even a parameter of `notify.ts`. Register `help_contact_notification: "account"` in `EMAIL_AUDIENCE`.

### Inbox (`src/lib/help-contact/inbox.ts`, `server-only`, the only file in `src/lib/help-contact/` that calls `getPlatformDb()`)

```ts
type PlatformExec = <T>(fn: (tx: OrgTx) => Promise<T>) => Promise<T>; // default: getPlatformDb().transaction (the DomainExec precedent in domains/service.ts)
listMessages(q: { status: "new" | "handled" | "spam" | "all"; before?: Date; limit?: number }, exec?): Promise<{ rows: InboxRow[]; hasMore: boolean }>;
readMessage(id: string, exec?): Promise<InboxDetail | null>;     // joins users for the two stamp names
setMessageStatus(actor: { userId: string; email: string | null }, id: string, to: Status, exec?): Promise<{ ok: true } | { ok: false; reason: "not_found" | "cleared_cannot_be_new" }>;
clearMessageDetails(actor, id, exec?): Promise<{ ok: true } | { ok: false; reason: "not_found" | "already_cleared" | "needs_triage" }>;
```

Keyset pagination on `created_at`, default 25 per page, `limit + 1` read to set `hasMore`. The optional `exec` parameter lets a DB test run an operation inside a transaction it rolls back. Each mutation is one transaction: `SELECT … FOR UPDATE`, the UPDATE, and `insertAuditRow(tx, …)` from `src/lib/audit-tx.ts` (the platform transaction is cast to `OrgTx` exactly as `domains/service.ts:207` does). Metadata is the message id and the from and to status only, never a personal field (CA10, AF-5).

### Admin actions (`src/app/(admin)/admin/messages/actions.ts`, `"use server"`)

```ts
setContactMessageStatus(id: string, to: "new" | "handled" | "spam"): Promise<ActionResult>
clearContactMessageDetails(id: string): Promise<ActionResult>
```

Each: `auth()`, signed-in check ("Not signed in."), `hasFeature(session.user.features, FEATURES.ADMIN_TICKETS)` ("Forbidden."), id is a UUID (else "That message could not be found."), then the `inbox.ts` call, then `revalidatePath("/admin/messages")` and the detail path. The file has no `db.` call, so `check:audit` is silent; the DB test below is the guard (AF-7). The audit write is in `inbox.ts`, where the keys are used. (Deviation from CA10's wording "the admin `actions.ts` still imports `AUDIT_ACTIONS`": the keys are imported where the audit row is written. Ruled here; nothing is lost because the test asserts the row.)

### Audit keys (`src/lib/audit.ts`)

`HELP_CONTACT_STATUS_CHANGED: "help_contact.status_changed"` and `HELP_CONTACT_DETAILS_CLEARED: "help_contact.details_cleared"`. Refusals reuse `RATE_LIMIT_BLOCKED` (CA5). `(admin)/admin/audit/page.tsx` builds its filter from `AUDIT_ACTIONS`; the implementer reads it to confirm the new keys appear without a label map.

## Data Model

### `drizzle/0083_presby_help_contact.sql` (hand-written, idempotent, applied `psql -1` as owner)

```sql
create table if not exists help_contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  topic text not null,
  name text,
  email text,
  congregation text,
  message text,
  status text not null default 'new',
  status_changed_at timestamptz,
  status_changed_by uuid references users(id),
  notified_at timestamptz,
  cleared_at timestamptz,
  cleared_by uuid references users(id)
);
```

**What the table never holds:** an IP, a user agent, an `organization_id`, a person id, or any user id for the sender (FC6, C2, C4). `0083` has a header comment saying so, and that the table is deny-all on purpose (the first FORCE-RLS table on the catalog with zero policies).

**CHECKs** (each `drop constraint if exists` then `add constraint`, the 0059 style):

- `help_contact_topic_allowed`: `topic in ('starting_a_congregation','signing_in','help_page_wrong','something_else')`.
- `help_contact_status_allowed`: `status in ('new','handled','spam')`.
- `help_contact_bounds`: `name` null or `char_length(name) <= 100`; `congregation` null or `char_length <= 150`; `email` null or `char_length <= 254`; `message` null or `char_length(btrim(message)) between 10 and 2000`.
- `help_contact_email_shape`: `email is null or (email !~ '[[:space:]]' and email ~ '^[^@]+@[^@]+\.[^@]+$')`.
- `help_contact_no_controls`: no C0 control other than tab and newline, and no DEL, in `name`, `email`, `congregation`, `message` (a regex on `\x01-\x08`, `\x0b`, `\x0c`, `\x0e-\x1f`, `\x7f`; Postgres text cannot hold NUL at all). The implementer verifies the regex literal against the DB test with a tab, a newline and a `\x01`.
- `help_contact_cleared_shape`: `(cleared_at is null) = (cleared_by is null)`; and either `cleared_at is null and email is not null and message is not null`, or `cleared_at is not null and name is null and email is null and congregation is null and message is null`.
- `help_contact_status_stamp_shape`: `(status_changed_at is null) = (status_changed_by is null)`.

**Indexes:**

- `help_contact_status_created_ix (status, created_at desc)`: the inbox and the dashboard card.
- `help_contact_created_ix (created_at)`: the database ceiling's counts.
- `help_contact_notified_ix (notified_at desc) where notified_at is not null`: the coalescing `exists`. (The architect wrote `created_at` for this partial index; the predicate reads `notified_at`, so the index is on `notified_at`. Ruled here.)

**Row security and grants:**

```sql
alter table help_contact_messages enable row level security;
alter table help_contact_messages force row level security;   -- NO policy, on purpose
revoke all on help_contact_messages from public, presby_app, presby_platform;  -- and grant nothing
```

`neondb_owner` (the `getPlatformDb()` role and the definer's owner; `rolbypassrls = t` on the live catalog) is unaffected. `presby_platform` cannot log in, so no grant to it. Any role without BYPASSRLS reads and writes nothing even if a future migration grants by mistake.

**Guards** (all `SECURITY INVOKER`, `set search_path = public, pg_temp`, `revoke all … from public, presby_app, presby_platform`, firing on the owner path too, the `account_invitations` precedent; refusals raise `insufficient_privilege` so a test can tell a guard from a CHECK):

- `presby_help_contact_guard_delete()`, `BEFORE DELETE`: always raises. (There is no teardown exemption: no organization is involved. Tests roll back; see the test plan.)
- `presby_help_contact_guard_update()`, `BEFORE UPDATE`, for each row:
  1. `id`, `created_at`, `topic` and `notified_at` cannot change.
  2. `name`, `email`, `congregation`, `message` can change only to null, and only in the same update that moves `cleared_at` from null to set. A change in any other circumstance raises.
  3. Clearing requires `cleared_by` non-null and the (new) `status <> 'new'`; the trigger sets `cleared_at := now()` itself (stamps forced, the careers precedent). Once `cleared_at` is set it, `cleared_by` and the nulls never change.
  4. A status change requires `status_changed_by` non-null; the trigger sets `status_changed_at := now()`. With the status unchanged the two stamps cannot change. A cleared row cannot return to `new`.
  - The operator can triage and clear; no path rewrites a stranger's words.
- No `BEFORE INSERT` guard. The only `presby_app` path is the definer, which writes the born-new shape itself. The CHECKs bind the owner path. (Named residual: an owner-path insert can be born `handled`; the owner is the operator's own connection.)

**The definer** (full body for the implementer):

```sql
create or replace function presby_submit_help_contact(p_topic text, p_name text, p_email text, p_congregation text, p_message text)
returns text language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  c_window     constant interval := interval '60 minutes';  -- the notification window; Copy E says "an hour"
  c_ceil_hour  constant integer := 90;                      -- 3x the limiter's 30 per hour
  c_ceil_day   constant integer := 300;                     -- 3x the limiter's 100 per day
  v_hour integer; v_day integer; v_notify boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('help_contact_messages', 0));   -- one lock covers the count and the claim
  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*)
    into v_hour, v_day
    from help_contact_messages where created_at > now() - interval '24 hours';
  if v_hour >= c_ceil_hour or v_day >= c_ceil_day then return 'ceiling'; end if;
  v_notify := not exists (select 1 from help_contact_messages where notified_at > now() - c_window);
  insert into help_contact_messages (topic, name, email, congregation, message, notified_at)
  values (p_topic, p_name, p_email, p_congregation, p_message, case when v_notify then now() end);
  return case when v_notify then 'stored_notify' else 'stored' end;
end $function$;
revoke all on function presby_submit_help_contact(text, text, text, text, text) from public, presby_app, presby_platform;
grant execute on function presby_submit_help_contact(text, text, text, text, text) to presby_app;
```

Constants are SQL constants, never parameters. The window and the two ceilings are pinned by the DB test below. CHECK violations (`23514`) inside the definer map to `not_sent` in TypeScript (the server validation already ran, so only a mismatch gets there). A `comment on table` records the retention posture: no automatic clearing, no period, and the clear-on-ask promise.

**Idempotency key (Phase 1 Note 1): not adopted.** A refresh or double-click can store a duplicate row; the cost is one extra row for the operator, which the analyst accepted. The island disables the button while pending. Recorded in the carry-forward as accepted.

### `src/lib/db/domain/help-contact.ts`

A TypeScript mirror (the `invitations.ts` precedent) with a header saying `drizzle/0083_presby_help_contact.sql` is the ground truth and that Drizzle Kit emits nothing for domain tables. `inbox.ts` imports `helpContactMessages` from this file directly, so nothing depends on the `src/lib/db/domain/index.ts` re-export, which (with `drizzle/meta/_journal.json`) is a Rule 16 file edited at integration only.

### Database tests, not in the shared `scripts/test-rls.sql`

`src/lib/db/domain/help-contact.db.test.ts` (owner path, serial, `describe.skipIf(!hasDb)`) and `scripts/help-contact/test-rls-83.sql` (as `presby_app`, the careers `test-rls-71.sql` precedent; folded into `scripts/test-rls.sql` at integration). Technique for determinism: every owner test runs inside a transaction it rolls back. Where a test needs an empty table it does `alter table help_contact_messages disable trigger help_contact_guard_delete`, `delete`, all inside the rolled-back transaction (DDL is transactional; the careers cap-trigger test is the precedent), so committed rows from earlier runs never change a count.

## Component / Page Plan

### Pages and files to create

Public:
- `src/app/(documentation)/help/contact/page.tsx`: static Server Component, `export const dynamic = "error"`, metadata title "Contact the PresbyPortal team" (root `noindex` inherited, R11). Calls `isHelpContactConfigured(process.env)` at build: configured renders the island, else the unavailable block.
- `src/app/(documentation)/help/contact/contact-form.tsx`: the `'use client'` island (below).
- `src/app/(documentation)/help/contact/contact-exit.tsx`: a presentational block (no hooks) used by the unavailable state, the "check didn't load" note and the `busy` outcome; links the repository with the standard "issues are public" warning.
- `src/app/(documentation)/help/contact/actions.ts`: the thin action above.
- **No `loading.tsx` and no `error.tsx`** (R9 amended: the page fetches nothing at render, `docs/ui-standards.md` line 542 does not apply; action failures are typed results, and the island turns an unexpected throw into `not_sent`).

Library `src/lib/help-contact/`: `contract.ts` (pure), `copy.ts` (pure: every string below that is not in a help page), `validate.ts` (pure), `configured.ts` (pure), `submit.ts` (`server-only`), `notify.ts` (`server-only`), `inbox.ts` (`server-only`). `src/lib/text-hygiene.ts` (lifted, pure). `src/lib/db/domain/help-contact.ts`. `src/lib/admin-portal/dashboard/messages.ts` (count-only reader, the `feedback.ts` shape: `select count(*)::int as new_count from help_contact_messages where status = 'new'`, `readCard("contact_messages", …)`).

Admin: `src/app/(admin)/admin/messages/page.tsx` (list), `[id]/page.tsx` (detail, `notFound()` on a non-UUID or a missing row), `actions.ts`, `message-triage.tsx` (client: three status buttons), `clear-details-dialog.tsx` (client: `AlertDialog`). No `loading.tsx` (DECISION-251).

E2E and config: `e2e/help-contact/form.spec.ts`, `e2e/help-contact/prod-build.spec.ts`, `e2e/help-contact/global-setup.ts`, `e2e/admin-contact-messages.spec.ts`, `e2e/help-contact-unavailable.spec.ts`; DB: `src/lib/db/domain/help-contact.db.test.ts`, `scripts/help-contact/test-rls-83.sql`.

### The island, `contact-form.tsx` (360px first)

- **Not `useForm`, not an `action={}` prop.** Controlled fields held in component state, submitted from `onSubmit` with `preventDefault()`, calling `submitHelpContactAction` inside `startTransition`. Reason: React 19 resets an uncontrolled form after an action prop completes, which would erase the visitor's text on a failure; controlled state keeps it (only `sent` clears it). `check:hydration-gate` matches `useForm`, so it does not apply; the island still wraps the form in `<HydrationGate>` and sets `method="post"`, because a pre-hydration native submit of a form with no `action` is a GET of the same URL with the typed text in the query string. A hydration e2e pins it (below).
- Layout: `mx-auto w-full max-w-xl space-y-5`; every field `w-full`; labels above fields (not placeholders); inputs and textarea 16px (no iOS zoom) and `min-h-11`; the topic is a native `<select>` (phone-native picker); autocomplete `name`, `email`, `organization`; `inputmode="email"`; the textarea has `rows={8}` and no `maxLength` (a native `maxLength` counts UTF-16 units and truncates a paste silently; the rule is reject, never truncate); the button is `w-full sm:w-auto min-h-11`; the Turnstile widget (300px) sits in `max-w-full`, which fits 360px minus 2 × 16px padding.
- **Honeypot (F388):** `name="_hp"`, `tabIndex={-1}`, `autoComplete="off"`, `aria-hidden="true"`, positioned off-screen (not `display:none`), label "Leave this field blank". No second silent-drop heuristic, no timing trap.
- **Submit gating:** the button is disabled until hydrated and a Turnstile token exists and no submit is pending; disabled-because-no-token has a visible reason line ("Waiting for the check to finish…").
- **Token handling:** a token is single-use. After any outcome except `invalid` the widget is remounted (`key` bump, the `give-form.tsx` precedent) and the token cleared. An `invalid` outcome returns before Turnstile spends the token, so the token is kept.
- **Errors:** field errors sit under the field, linked by `aria-describedby`; on a failed submit an error summary (`role="alert"`, `tabIndex={-1}`) receives focus and lists links to the fields. No colour-only status.
- **Counter:** a visible "{n} of 2,000 characters" (counted with `charCount`), and a visually hidden `aria-live="polite"` region updated only at 1,800 and at 2,000, never per keystroke.
- **Success:** replaces the form, focus moves to it (`role="status"`, `tabIndex={-1}`). No reference number. No toast (the `(documentation)` layout has no toaster); the status block is the record.
- **Check didn't load (FC9):** the widget's `onError`, or no `window.turnstile` after 8 seconds, shows the "check didn't load" note with the exit block (the form stays visible). The page also renders a `<noscript>` block with the same exit.
- Imports allowed: React, `@/components/ui/*`, `@/components/shared/{turnstile,hydration-gate}`, `@/lib/text-hygiene`, `@/lib/help-contact/{contract,copy}`, `@/lib/help/urls`, `./actions`, `./contact-exit`. Nothing server-only (H19 walks it).

### The admin inbox at 360px

- **List (`/admin/messages`):** the Feedback page's card layout, not a table. Filter links "New", "Handled", "Spam", "All" (`?status=`, default `new`), a `flex-wrap gap-2` row of `min-h-11` links. Each card: `rounded-lg border p-4`, a wrapping row with the date (`FormattedDate`, datetime), the topic label and a status badge (a "Cleared" badge too); the name or "No name given"; a 140-character plain-text excerpt (`break-words`); a `min-h-11` "Read message" link. An "Older messages" link keyed on the last `created_at` (`?before=<ISO>`, validated, bad input ignored). The page checks `auth()` and `hasFeature(…, ADMIN_TICKETS)` itself; a failed read renders `LoadError` (no `loading.tsx`).
- **Detail (`/admin/messages/<id>`):** a stacked definition list: Sent, Topic, Name, Email, Congregation, Message. Every field is plain text in an isolated `whitespace-pre-wrap break-words [overflow-wrap:anywhere]` container: never markdown, never HTML, never auto-linked, no `dangerouslySetInnerHTML` (C8, FC8). The email carries the "Not verified" label and the guidance line (Copy D). Below: the three status buttons (hiding the current one) and "Clear details" (shown only when the status is not `new` and the row is not cleared; otherwise a one-line reason). Buttons are `w-full sm:w-auto min-h-11`. The `AlertDialog` is `max-w-[calc(100vw-2rem)]`.
- Dashboard card (`contact_messages`, zone `support`, title "Contact messages", headline "{n} new" or all clear, `ADMIN_TICKETS`) and nav item ("Contact messages", `/admin/messages`, `ADMIN_TICKETS`, Support group) carry the same key as the page (`visible-nav` test).

### Files to modify

- `src/lib/rate-limit.ts` (the split, below).
- `src/lib/careers/text.ts` becomes a re-export of `src/lib/text-hygiene.ts` (its five importers do not change).
- `scripts/lib/import-graph.mjs`, `scripts/lib/help-boundary.mjs`, `scripts/lib/help-boundary.test.mjs` (H19, below).
- `src/app/(documentation)/shell-boundaries.test.ts`.
- `src/lib/help/links.ts` (`FIXED_INTERNAL` gains `"/help/contact"`) and `links.test.ts`; `src/lib/help/urls.ts` (adds `HELP_CONTACT_HREF`); `src/lib/help/contact.ts`, `tokens.ts`, `copy.ts`, `checks.ts`, `registry.ts`; `src/components/help/needs-block.tsx`; `src/app/(documentation)/layout.tsx`, `help/not-found.tsx` (no change needed, see Copy K).
- `src/lib/audit.ts`, `src/lib/contact-methods/email-audience.ts`, `src/lib/admin-portal/nav.ts`, `src/app/(admin)/admin/_dashboard/{registry.ts,cards.tsx,present.ts}`, `src/lib/admin-portal/dashboard/boundaries.test.ts`.
- `playwright.config.ts`, `package.json` (two scripts), `.github/workflows/e2e.yml` (one step per lane), `docs/testing.md` (the public Cloudflare test values, annotated for `check:secrets`).
- Ship housekeeping (orchestrator, Rules 10, 14, 15, 17): `docs/TODO.md`, `docs/product/functionality-map.md`, `docs/release-notes/vX.Y.md`, `docs/deployment.md` (the runbook below), CLAUDE.md Project Layout line for `src/lib/help-contact/`, `.claude/agents/architect.md` route-group sentence (CA9), `src/lib/db/domain/index.ts`, `drizzle/meta/_journal.json`, `scripts/test-rls.sql`. `docs/architecture.md`: no update (Rule 15).

### `rate-limit.ts` split (DECISION-302)

```ts
export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };
export async function consumeRateLimit(key: string, limit: { max: number; windowSeconds: number }): Promise<RateLimitResult>; // honours RATE_LIMIT_DISABLED; no audit
export function recordRateLimitBlock(key: string, context: { userId?: string | null; actor: string; reason: string }, retryAfterSeconds: number): void; // the existing fire-and-forget audit_events insert; sets no ip column
export async function checkRateLimit(key, limit, context): Promise<RateLimitResult>; // = consumeRateLimit, then recordRateLimitBlock on a refusal; signature and behaviour unchanged
```

The audit insert, its metadata (`reason`, `actor`, `retryAfterSeconds`), the `actorEmail` rule and the swallowed rejection move verbatim into `recordRateLimitBlock`. `checkRateLimit`'s existing tests pass unedited: that is the guard for every other caller. New tests: `consumeRateLimit` never touches `db`; `recordRateLimitBlock` writes the same row shape with no `ip`.

**Bounded refusal audit (CA5).** On any refusal the contact form calls `consumeRateLimit("help_contact:audit:<kind>", { max: 1, windowSeconds: 3600 })` and only when that allows calls `recordRateLimitBlock("help_contact:<kind>", { userId: null, actor: "anonymous", reason: "help_contact_form" }, retry)`, `<kind>` being `ip`, `global` or `ceiling`. That is at most one audit row per kind per hour, and the rows carry no IP (the audit key has none). It uses `recordRateLimitBlock`, not `recordAudit` (which imports `@/auth`).

### H19 `stopAt` change (DECISION-304)

- `scripts/lib/import-graph.mjs`: `checkImportBoundary` gains `stopAt?: string[]` (default `[]`, so `check:proxy-imports` is unchanged). A stop file is a node that is reached and counted, but whose source is not scanned and whose imports are not followed.
- `scripts/lib/help-boundary.mjs`: delete `EXEMPT`. Add `SERVER_ACTION_STOPS = ["src/app/(documentation)/help/contact/actions.ts"]`, exactly one file. `helpBoundaryEntries` also skips the stop file (otherwise it would be an entry and fail on `next/headers`). `checkHelpBoundary` passes `stopAt: SERVER_ACTION_STOPS`. `page.tsx` and `contact-form.tsx` stay entries, and everything they import is walked, including `src/lib/help-contact/contract.ts`, `copy.ts`, `configured.ts` and `src/lib/text-hygiene.ts`, so they must stay pure.
- Two new H19 violations, each with a fixture in `scripts/lib/help-boundary.test.mjs`: (a) the stop file's first statement is not `"use server"`; (b) a file outside `src/app/(documentation)/help/contact/` imports the stop file (found by scanning every non-test file's resolved specifiers, independent of the walk). A missing stop file is a P4-style failure.
- `src/app/(documentation)/shell-boundaries.test.ts`: `ownedSources()` excludes exactly that one path (a named constant); a dedicated test pins `actions.ts` (begins with `"use server"`; its imports are a subset of `next/headers`, `next/server`, `@/lib/help-contact/*`, `@/types/actions`; no `auth()`, `cookies()`, `searchParams`, `getPlatformDb`, `@/auth`; exactly one export); the `dynamic = "error"` count goes from 4 to 5 and the expected-routes list gains `help/contact/page.tsx`; the `loading.tsx` and `error.tsx` bans keep no carve-out.
- `src/lib/help-contact/boundaries.test.ts`: the graph reached from `actions.ts` never contains `getPlatformDb(` (the definition in `src/lib/db/index.ts` excepted); `inbox.ts` is imported nowhere under `src/app/(documentation)/**`; `contract.ts`, `copy.ts`, `validate.ts`, `configured.ts` import no `server-only`, no `@/lib/db`, no `next/*`.

### `text-hygiene.ts` lift (CA12)

Move the body of `src/lib/careers/text.ts` (`charCount`, `normalizeMultiline`, `cleanText`, the four regexes) to `src/lib/text-hygiene.ts` unchanged, with the header comment updated. `careers/text.ts` becomes `export * from "@/lib/text-hygiene"` (the R8 pure-sibling pattern); the five importers and `careers/text.test.ts` pass unedited, plus a test that both modules export the identical functions. The weaker copy in `src/lib/onboarding/input.ts` is a TODO line (AF-8), not this pipeline.

### `configured.ts` (CA6, DECISION-303)

```ts
export function isHelpContactConfigured(env: Readonly<Record<string, string | undefined>>): boolean
```

Requires `TURNSTILE_SECRET_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in every environment (development and e2e use Cloudflare's public test keys). In a production deployment (`isProductionDeployment(env)`) it also requires both Upstash variables, `RATE_LIMIT_DISABLED !== "true"`, and (added here) that neither key is one of Cloudflare's published dummy values: the secrets `1x0000000000000000000000000000000AA`, `2x0000000000000000000000000000000AA`, `3x0000000000000000000000000000000AA` and the site keys `1x00000000000000000000AA`, `2x00000000000000000000AB`, `1x00000000000000000000BB`, `2x00000000000000000000BB`, `3x00000000000000000000FF`. A dummy secret in Production would make the check meaningless (the always-pass key) or break the form (the others); refusing it turns the runbook's "test keys never in Production" from a hope into the unavailable state. The literals carry `// leak-ok:` if `check:secrets` flags them.

### Help and chrome (Rule 17)

Pages edited are listed in Copy F to K; the implementer edits each from the screens, at 360px, after the form exists (Batch 5). `verifiedIn` moves only by the Phase 6 walk, at ship.

## Implementation Order and Batches

Each batch ends with its gates (typecheck, the unit suite, `npm run check`, and for Batch 1 the serial DB suite) and a Phase 4 section in this log; the orchestrator commits between batches. No batch edits a Rule 16 file.

1. **Batch 1 — database-admin: migration 0083 and its proofs.** `drizzle/0083_presby_help_contact.sql`, `src/lib/db/domain/help-contact.ts`, `scripts/help-contact/test-rls-83.sql`, `src/lib/db/domain/help-contact.db.test.ts`. Applied to the pipeline Neon branch (`pipeline-help-contact`) with `psql -1` as owner. Gate: the DB suite passes serially; the live-catalog proof (below) is pasted into the Phase 4 section. *First batch; database-admin.*
2. **Batch 2 — full-stack-developer: the server half, no UI.** `text-hygiene` lift; `rate-limit.ts` split; `import-graph.mjs` / `help-boundary.mjs` `stopAt` and their fixtures; `src/lib/help-contact/{contract,copy,validate,configured,submit,notify}.ts`; `actions.ts`; the two audit keys; `EMAIL_AUDIENCE` entry; unit and source-scan tests. Needs the table from Batch 1 only for the DB-backed tests; the unit tests mock the definer.
3. **Batch 3 — full-stack-developer: the public page and the e2e lane.** `page.tsx`, `contact-form.tsx`, `contact-exit.tsx`, `shell-boundaries.test.ts`, the Playwright contact lane (`playwright.config.ts`, scripts, `e2e.yml`, `docs/testing.md`), `e2e/help-contact/*`, `e2e/help-contact-unavailable.spec.ts`. The CA13 production-lane proof runs here, as soon as the page and action exist: **if it fails, stop and loop back to Phase 2; never switch the segment to `force-static`.**
4. **Batch 4 — full-stack-developer: the admin inbox.** `inbox.ts`, `messages/` pages and actions and client islands, nav item, dashboard reader and card, `boundaries.test.ts` allow-list, the admin e2e, the audit and guard tests (the CA10 test).
5. **Batch 5 — full-stack-developer: help content and chrome.** `contact.ts` constants, `{{contactAdmin}}` token, `links.ts`, `urls.ts`, `copy.ts`, the layout footer, `needs-block.tsx`, the 10 page edits and registry entries, existing-test updates. Last, so each page is edited from the shipped screens.
6. **Ship (orchestrator and tech-lead, after Phase 6 SHIP IT):** the integration files, the runbook into `docs/deployment.md`, the release note, `package.json` version, TODO, functionality map, the CLAUDE.md and `architect.md` lines, `verifiedIn` after the Phase 6 walk.

## Test Plan

**Unit (Vitest, no database).** The implementer writes these; QA runs them.

- `text-hygiene.test.ts`: NFC, controls, bidi, zero-width, code-point counting (an emoji is one); `careers/text.ts` re-exports the identical functions.
- `validate.test.ts`: every row of the validation table; a 2,000-code-point message with emoji passes and 2,001 is `too_long`; whitespace-only and 9-character messages are `too_short`; NUL and a bidi override are stripped; email shape cases; an unknown topic; overlong input is rejected, not truncated.
- `configured.test.ts`: the full matrix (development needs the Turnstile pair; production also needs both Upstash variables and the limiter enabled; each dummy key refused in production and accepted outside it).
- `submit.test.ts` (the limiter, Turnstile, `db`, notify and `headers` faked): the order of checks, asserted by call sequence. A custom host, an IP literal and a missing host return `unavailable` before anything is spent (CA7). Unconfigured returns `unavailable`. A honeypot returns `sent` and spends nothing. `invalid` never calls Turnstile. No usable IP skips the per-IP check and never uses a shared `unknown` key (CA8); a non-IP header value is treated as no IP; the key's IP part never contains typed text. Turnstile false returns `check_failed` without consuming the global ceiling. The global ceiling is consumed only after Turnstile. Definer tokens map correctly; `ceiling` returns `busy`. SQLSTATE `42501` returns `unavailable`; another error returns `not_sent`; an Upstash throw returns `not_sent`. Each refusal calls the audit gate and writes at most one row per kind; the audit key contains no IP. `stored_notify` calls notify; `stored` does not; a notify throw does not fail the submission. `console.*` is never called with the message, name, email or congregation.
- `notify.test.ts`: recipients come from `getTicketOperatorPool()`; none means a warning and no queue row; one queue row per operator in one transaction; the provider attempts run in `after()`; no queue row's `to` equals the typed address (C9; `notify` does not receive it); the message is the constant, content-free one.
- `rate-limit.test.ts`: the existing file passes unedited; new cases for `consumeRateLimit` (no `db` call) and `recordRateLimitBlock` (same row shape, no `ip`).
- Source scans: `boundaries.test.ts` in `src/lib/help-contact/`; `shell-boundaries.test.ts`; `scripts/lib/help-boundary.test.mjs` (the two new H19 violations, the stop file reached but not followed, `check:proxy-imports` unchanged).
- Help: `tokens.test.ts` (`{{contactAdmin}}` known, unknown tokens still fail H5, no re-expansion), `links.test.ts` (`/help/contact` resolves; `/help/contact#x` and `/help/contact/x` do not), a `contact.test.ts` (the line contains `HELP_CONTACT_HREF`; the repository URL is in the allowlist; neither line contains the word "ticket" outside the admin line), `help-components.test.tsx` (needs-block plain text), `layout.test.tsx` (footer link, 44px, print hidden), `content.test.ts` (no `{{contact}}` or `{{contactAdmin}}` survives loading).
- The island (jsdom): the labels in Copy A; the honeypot attributes; submit disabled until hydrated, a token exists and not pending; a failure keeps the typed text; each outcome renders its string from Copy B and C; the error summary receives focus; the counter announces only at 1,800 and 2,000; the widget remounts after every outcome except `invalid`; `onError` and the 8-second timer (fake timers) show the "check didn't load" note with the exit block; the unavailable component and `<noscript>` carry the exit block; a thrown action becomes `not_sent`.
- Admin: the page and each action refuse without `admin.tickets` (and without a session); a non-UUID id is not found; `before` and `status` are validated; the card, the nav item and the registry entry carry the same key; a body containing `<script>`, a URL and markdown renders as inert text (no anchor, no element).

**Database (serial, `npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/help-contact.db.test.ts`).** As owner, each in a rolled-back transaction: the DELETE guard fires on the owner path; the UPDATE guard refuses a rewrite of any personal field outside a clear, a change to `id`/`created_at`/`topic`/`notified_at`, an un-clear, a clear while `new`, and a cleared row returning to `new`; a status change forces `status_changed_at`; each CHECK refuses its violation (bounds, the topic, the control-character regex with a tab and newline allowed, the cleared shape). The definer: `'stored_notify'` for the first row and `'stored'` for the second within the window; a row with `notified_at` older than 60 minutes lets the next one claim; **two concurrent calls on two connections produce exactly one `'stored_notify'`** (the careers advisory-lock precedent); the hourly and daily ceilings return `'ceiling'` and write nothing (90 and 300 rows built in the rolled-back transaction); the stored row holds the typed values and no other column is set. As `presby_app` (`set local role`): SELECT, INSERT, UPDATE and DELETE each fail with `42501`; EXECUTE succeeds; after `revoke execute … from presby_app` in the same transaction the call fails with `42501` (which `submit.ts` maps to `unavailable`); `has_function_privilege('public', …, 'execute')` is false. **The CA10 test:** `setMessageStatus` and `clearMessageDetails` called with an `exec` bound to the rolled-back transaction write exactly one `audit_events` row each (`help_contact.status_changed`, `help_contact.details_cleared`), whose `metadata` text contains none of the seeded name, email, congregation or message strings; a refused second clear writes no row. `scripts/help-contact/test-rls-83.sql` repeats the `presby_app` proofs as plain SQL.

**Live-catalog proof (QA, Phase 5, on the branch after 0083).** `relforcerowsecurity = true`; `pg_policies` has zero rows for the table; `aclexplode(relacl)` shows no `presby_app` and no PUBLIC entry; `pg_trigger` shows the two guards; `proacl` shows EXECUTE for `presby_app` only; `prosecdef = true` and `proconfig` pins `search_path`.

**E2E.** No spec depends on a feature flag.

*Contact lane* (`npm run test:e2e:contact`: `PW_HELP_CONTACT=1 playwright test --project=contact`; its own dev server on `E2E_BASE_URL` port 3670, no `RATE_LIMIT_DISABLED`, Cloudflare's public always-pass test keys in the server's environment only, and its own `globalSetup` that runs the database-isolation guard and signs nobody in). Rows are verified through the owner connection (`platformSql`), never through an admin session, so the keys never meet the sign-in form. A canary first asserts the form (not the unavailable block) renders. Specs, in `e2e/help-contact/form.spec.ts`:

1. Happy path at 360px with the Cloudflare script stubbed by `page.route` (it calls the callback with the public dummy token): the success block appears, a row exists with the typed values (marker string), no horizontal overflow, and **no `email_queue` row has `to_email` equal to the typed address**.
2. Field errors keep the typed text; the error summary takes focus; Turnstile is not spent (the same token submits after the fix).
3. The honeypot returns the same success and writes no row.
4. **One live-limiter run:** from one `x-real-ip`, three submissions are stored and the fourth shows the busy string; a different `x-real-ip` still succeeds; after several refusals exactly one `rate_limit.blocked` row exists with resource id `help_contact:ip`, with no `ip` column value and no typed marker in its metadata (CA5). The server's in-memory limiter is per server lifetime, so each test uses its own `x-real-ip`; the lane's stored-row budget is at most 6, because the database ceiling (90 per hour) counts committed rows across runs. A pre-check fails fast with an explanation if the table already holds 60 rows from the last hour.
5. Notification coalescing, state-independent: over N submissions, rows with `notified_at >= test start` number at most 1, and new `help_contact_notification` queue rows equal that count times the operator count; none of them contains the marker. (The exact first-claim case is pinned by the DB test, because a row from an earlier run within the hour can hold the slot.)
6. Turnstile script blocked (`route.abort`): the "check didn't load" note and the exit block show and the form stays usable for reading; JavaScript disabled shows the `<noscript>` exit.
7. Pre-hydration (`e2e/hydration` method: hold `/_next/static/**.js`, load with `domcontentloaded`): every field is disabled, then enabled after release; typed text is never in the URL.
8. **The custom-host POST (CA7, the running proof):** capture a legitimate submission's `Next-Action` header and body, replay it with `Host: church-one.invalid` through the `request` fixture (the `rawPost` approach of `lockdown.spec.ts`), and assert no row (marker query), no `sent` outcome and no cookie. This is in the contact lane precisely because the default lane has no keys, where "unavailable" would be the answer for the wrong reason.

*Production lane for CA13* (`npm run test:e2e:contact:prod`: `PW_PROD_BUILD=1 PW_HELP_CONTACT=1 playwright test --project=contact-prod`, `next build && next start` on `PW_PROD_PORT=3671`, the same keys present at build because the site key is baked in). `e2e/help-contact/prod-build.spec.ts`, the named proof for **CA13**: "a Server Action in a `dynamic = "error"` segment can call `headers()` and `after()` at request time". It (a) loads `/help/contact` and sees the form with HTTP 200 and no `set-cookie` (static; the implementer pins the cache header the build actually emits); (b) submits through the UI with the stubbed script and sees the success block, then confirms the row through the owner connection; (c) sends `x-real-ip: 198.51.100.7` on every request, stores three and sees the fourth refused as busy, which proves `headers()` was non-empty inside the action and the per-IP key was derived from it; (d) asserts the notification queue rows exist when the slot was claimed (case 5's rule). **Failure is a loop-back to Phase 2.** The segment is not to be switched to `force-static`: that could make `headers()` empty and silently remove the per-IP limit.

*Default lane* (no keys, the existing server): `e2e/help-contact-unavailable.spec.ts` (the page renders the unavailable block with the exit links, HTTP 200, `noindex`, no form, no horizontal overflow at 360px; the footer link on a help page is 44px high); `e2e/admin-contact-messages.spec.ts` (seed three rows through the owner connection that satisfy the CHECKs; the admin storage state opens `/admin/messages` at 360px with no overflow; the New filter lists the seeded rows; the detail page shows "Not verified. Anyone could have typed this address."; "Mark as handled" changes the status; "Clear details" opens the dialog, confirming blanks the fields; a 2,000-character unbroken string does not overflow; the member fixture is refused; `afterAll` marks the seeded rows spam and clears them, because rows cannot be deleted); `e2e/help.spec.ts` gains the footer assertions.

**Blast radius: existing specs this change alters (each re-run, edited where noted).**

- `src/app/(documentation)/help/help-routes.test.tsx:77` asserts `"Steps. Ask the person who invited you."` as one text node; `{{contact}}` now carries a link, so the assertion changes (edit). `:50` (`indexNote`) is unchanged.
- `src/components/help/help-components.test.tsx:96` asserts the needs-block text built from `HELP_CONTACT_LINE` (edit: plain text).
- `src/lib/help/tokens.test.ts`, `content.test.ts`, `checks.test.ts`, `links.test.ts`, `src/app/(documentation)/layout.test.tsx`, `shell-boundaries.test.ts` (counts 4 to 5, routes list), `scripts/lib/help-boundary.test.mjs` (the `EXEMPT` fixture is removed).
- `src/app/(admin)/admin/_dashboard/cards.test.tsx:57` (the view map must equal the registry ids; the `readers` mock list needs the new reader), `visible.test.ts`, `present.test.ts`, `src/app/(admin)/admin/visible-nav.test.ts` and `src/lib/admin-portal/nav.test.ts` (the Support group gains an item; "keeps the labels existing e2e specs match by name"), `src/lib/admin-portal/dashboard/boundaries.test.ts` (allow-list gains `help_contact_messages`, on purpose, in review), `src/lib/contact-methods/email-audience.test.ts` (a new template key must be classified).
- `e2e/help.spec.ts:46,161` (every published page responds 200 with one h1; no overflow at 360px, now with a footer), `e2e/help-404.spec.ts` (the 404 now has the footer), `e2e/admin-shell.spec.ts:19,63` (zones and nav headings; the Support group has one more link), `e2e/custom-domains/lockdown.spec.ts:125` (the GET of `/help/contact` on a custom host stays a neutral 404; unchanged).
- Sign-in regression (QA): the `rate-limit.ts` split touches a module `src/auth.ts` calls, so QA reruns the existing sign-in e2e (`totp-full-login.spec.ts`, `admin-login.spec.ts`) as a regression check.

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| **FC1 / F382** no human reply path | Operator replies by hand; no code path mails the typed address (API Contract, Notification; test "no queue row `to` equals typed"). Copy B (success) and F-G promise no reply and no time. In-app reply: out of scope, TODO line (*deferred*, analyst Out of Scope, confirmed by operator Q1). |
| **FC2 / F383** claim, not proof | Copy D ("Not verified" label and guidance), Copy B (`signing_in` success sentence), runbook section 2. No code authority flows from a message. |
| **FC3 / F384** kill switch | CA6 as restated: `configured.ts` (page at build, action at runtime), the EXECUTE-revoke lever mapped from SQLSTATE `42501`, redeploy as the durable lever (Runbook 4). |
| **FC4 / F385** coalescing and recipients | The definer's advisory lock, `notified_at` and 60-minute constant; recipients from `getTicketOperatorPool()`; queue row before the response, send in `after()` (Data Model, API Contract). Dashboard card is the backstop. |
| **FC5 / F386** audit flood | `consumeRateLimit` / `recordRateLimitBlock` split; one audit row per kind per hour, no IP in the key (Component Plan). |
| **FC6 / F387** retention, strangers' data | No IP or user agent column; point-of-collection notice (Copy A); "Clear details"; privacy-policy edits (Copy I); no sweep (*deferred*, operator Q4: a timed sweep is a TODO line). |
| **FC7 / F388** honeypot loses real messages | `_hp`, off-screen, `tabIndex={-1}`, `autoComplete="off"`, `aria-hidden`; no second heuristic (The island). Residual: not walked against every password manager (*unverified*). |
| **FC8 / F389** input boundaries | `validate.ts` + lifted `text-hygiene.ts`, CHECKs repeat bounds, plain-text isolated containers on the operator side. |
| **FC9 / F390** unavailable dead end | The exit block shared by unavailable, "check didn't load", `busy` and `<noscript>`; ship order (Runbook 1). |
| **FC10 / F391** help edit size | Copy F to L, the 13 readers each read, listed in Help impact. |
| **Q1–Q11** operator defaults | Honoured as the opening list records; Q8: no change to `src/app/page.tsx` (*deferred*, operator). |
| **Phase 1 Note 1** double submit | Button disabled while pending; no idempotency key; a duplicate row is accepted (analyst). |
| **Note 2** blocked script or no JS | `onError`, 8-second timer, `<noscript>`, shared exit block. |
| **Note 3** hydration | State: `HydrationGate` plus `method="post"`, no `useForm`; hydration e2e case 7. |
| **Note 4** static group carve-out | CA9 (below). |
| **Note 5** live limiter coverage | The contact lane runs with the limiter on; e2e case 4. (Also the submission-grants follow-up 7 gets its answer for this form only; the other forms are *deferred*.) |
| **Note 6, 7** 360px, admin card layout | Component Plan. Light and dark and every viewport claim are walked in Phase 6, not asserted by a test (*unverified* until then). |
| **Note 8** route is not a registry page | `FIXED_INTERNAL` gains `/help/contact`; `RESERVED` already holds the slug. |
| **Phase 1 adversarial: custom host POST** | CA7; e2e case 8. |
| **Phase 1 adversarial: per-IP evasion** | AF-2 treatment (usable-IP rule, courtesy only, global and database ceilings). |
| **C1** (amended) | Domain file plus definer-only (CA1); not `schema.ts`, not INSERT-only. |
| **C2** not a ticket | No `organization_id`, no person id; copy never says "ticket" for the form, bar the admin line that names the other route (Copy F); the help copy tells readers a message is not a ticket (Copy G). |
| **C3** (order amended by CA2) | API Contract order of checks, 1 to 8. |
| **C4** enumeration-neutral | No lookup on typed email, name or congregation; one `sent` outcome; limiter keys hold the IP only; the notice and success copy never vary by who typed what (the topic-dependent paragraph varies by the visitor's own choice, not by any lookup). |
| **C5** (recipients amended) | Content-free email to `ADMIN_TICKETS` holders; never to the typed address; coalesced; `EMAIL_AUDIENCE` `account`. |
| **C6** (amended: test not `check:audit`) | Two audit keys; the CA10 DB test; no personal field in `metadata`. |
| **C7** `ADMIN_TICKETS` | Permissions; page gate, action gate, nav and card carry the same key. |
| **C8** plain text, bounded | Isolated plain-text containers, no auto-link; bounds in `validate.ts` and CHECKs. |
| **C9** retention posture, example.invalid | Data Model, Copy I; fixtures use `example.invalid`; e2e asserts no mail to the typed address. |
| **C10** (amended) | Redeploy plus EXECUTE revoke; Turnstile-hostname lever marked unverified and not recommended (Runbook 4). |
| **R8, R9** (R9 amended) | No `error.tsx` or `loading.tsx` under the contact segment; H19 handled by CA9. |
| **CA1** definer-only table | Data Model: no `presby_app` privilege, FORCE RLS with no policy, guards, closed outcome tokens, no id returned; live-catalog proof. |
| **CA2** order of checks | API Contract. |
| **CA3** coalescing in the definer | Data Model (the function), DECISION-301; no fifth cron. |
| **CA4** recipients and sending | `notify.ts`; queue insert before the response, `after()` for the provider attempt; failure never fails the submission; follow-up TODO for `getTicketOperatorPool()` ignoring `users.is_active` (*deferred*, architect). |
| **CA5** limiter audit bound | Component Plan, `rate-limit.ts` split; `checkRateLimit` unchanged. |
| **CA6** configured-check | `configured.ts` plus the dummy-key refusal (a tightening, ruled here). |
| **CA7** custom host | Step 1; unit test; e2e case 8. |
| **CA8** no-IP case | Step 5 and the usable-IP rule. |
| **CA9** H19 carve-out | `stopAt`, `SERVER_ACTION_STOPS`, two new violations, `shell-boundaries` pins, `boundaries.test.ts`. |
| **CA10** triage audit | One transaction, `insertAuditRow`, ids and statuses only; DB test. |
| **CA11** retention | No IP or user agent on the row or in refusal rows; no sweep; the policy states no period. |
| **CA12** normalization | `validate.ts` plus the lifted `text-hygiene.ts`. |
| **CA13** production-lane proof | Edge Cases 1; test `e2e/help-contact/prod-build.spec.ts`; loop-back to Phase 2 on failure. |
| **AF-1 / F406** no INSERT-only precedent | Resolved by CA1. |
| **AF-2 / F407** `cf-connecting-ip` unverified | Courtesy-only per-IP; usable-IP rule; no claim in copy about IP protection. Platform-wide fix is its own bug-fix pipeline with the MFA e2e smoke (TODO line at integration, gated on the preview-deployment protocol; *deferred*, architect). |
| **AF-3 / F408** no instant kill switch | Runbook 4 says redeploy is the durable lever and EXECUTE revoke the immediate one; no copy says "instant". |
| **AF-4 / F409** timing oracle | The queue insert is before the response and only the provider attempt is in `after()`. |
| **AF-5 / F410** clearing must not survive in audit | `metadata` holds ids and statuses only; DB test. |
| **AF-6 / F411** H19 exemption too wide | `EXEMPT` removed; one named stop file. |
| **AF-7 / F412** `check:audit` is `paper` here | The DB test replaces it; stated in Data Model and API Contract. |
| **AF-8 / F413** normalizer drift | One lifted module; the onboarding copy is a TODO line (*deferred*, architect). |
| **Architect handoff:** CLAUDE.md Project Layout line, `architect.md` sentence | Listed in Ship housekeeping for the orchestrator and operator. `docs/architecture.md`: no update. |

## Edge Cases & Risks

Each claim cites the test that pins it, or says *unverified*.

1. **A Server Action inside a `dynamic = "error"` segment calling `headers()` and `after()` (CA13).** Not provable from source. Pinned by `e2e/help-contact/prod-build.spec.ts` on the production lane (`next build && next start`). A failure is a loop-back to Phase 2; the segment is never switched to `force-static`.
2. **Turnstile turns on at sign-in, forgot-password and the public give form when the Production keys are set** (feasibility check). Not a defect of this design, but a sitewide behaviour change the operator may not expect. Runbook 1 says walk each after the deploy. *Unverified in production* until Phase 6. Operator question below.
3. **The Turnstile-hostname lever disables sign-in as well.** The widget's error callback blanks the token and `signin-credentials-form.tsx:26` keeps submit disabled without one, so removing the production host from the widget's allowed hostnames would stop everyone signing in. Runbook 4 marks lever B "do not use". *Unverified* (not walked).
4. **Double submit and refresh.** A duplicate row is possible and accepted. Pinned: the island test that the button is disabled while pending.
5. **Typing before hydration.** `HydrationGate` plus `method="post"`. Pinned by e2e contact-lane case 7.
6. **Turnstile blocked, slow or unconfigured at the client.** Pinned by the island tests (`onError`, the 8-second timer) and e2e case 6. The note keeps an exit.
7. **Token reuse.** The widget remounts after every outcome but `invalid`; an `invalid` outcome returns before Turnstile spends the token. Pinned by `submit.test.ts` (no Turnstile call on invalid) and e2e case 2. Cloudflare's own "already spent" answer: *unverified* (needs the `3x…` dummy secret).
8. **Cloudflare outage.** `verifyTurnstile` fails open (DECISION-026). Accepted; the global ceiling and the database ceiling bound it. Pinned for the bound by `submit.test.ts` and the DB ceiling tests; the fail-open itself is `src/lib/turnstile.test.ts`.
9. **A client-supplied `cf-connecting-ip`.** Per-IP is a courtesy (AF-2). Pinned: `submit.test.ts` (non-IP values are ignored). Whether Vercel strips the header: *unverified* (the architect's preview-deployment protocol, a separate pipeline).
10. **Global ceiling spent by an attacker.** Honest senders see `busy` for that window. Accepted (Phase 1); detected by the bounded `rate_limit.blocked` rows. Pinned by e2e case 4 for the audit bound; the global path by `submit.test.ts`.
11. **Upstash down.** `not_sent`, fail closed. Pinned by `submit.test.ts`.
12. **The notification is lost** if the enqueue fails; the dashboard card is the backstop. Pinned by `notify.test.ts` (failure is swallowed and logged by class). No operator holds `admin.tickets`: a warning and no email; the message is still stored. Pinned by `notify.test.ts`.
13. **Two submissions at the coalescing boundary.** Exactly one `stored_notify`. Pinned by the concurrent-connections DB test.
14. **A flood past a misconfigured limiter.** The definer's 90 per hour and 300 per day return `ceiling`. Pinned by the DB ceiling tests. The first message after the ceiling clears resumes normally.
15. **The messages cannot be deleted, so tests leave rows.** Owner tests roll back. E2E rows stay: the admin spec clears its own, and the contact-lane specs budget at most 6 stored rows per lane so the 90-per-hour ceiling is not tripped by local iteration (the pre-check in case 4 explains it if it is).
16. **Operator reading hostile text.** Bidi overrides and zero-width characters are stripped on save (`validate.test.ts`); the detail page renders plain text in `break-words` containers (admin unit test; e2e at 360px with a 2,000-character unbroken string). Auto-linking and markup: pinned by the admin unit test.
17. **Clear details on a `new` message.** Refused by the guard (DB test) and by the page (the button is absent, the reason line shows). A cleared row cannot return to `new` (DB test).
18. **Preview deployments** show the unavailable block because the keys are Production-scope. Expected; *unverified* until Phase 6.
19. **Autofill filling the honeypot.** Mitigated, not eliminated: *unverified* against every password manager.
20. **Help-page merge conflicts.** Five other help-tokened pipelines edit pages this design touches (feasibility check). The edits here are one-token swaps; the orchestrator resolves at integration.
21. **The Needs block is latent.** No registry entry sets `operatorEnabled` today; the plain-text change is pinned by `help-components.test.tsx`.
22. **A `fix:`-class string added later** gets the four Copy checks before it is written.

## Copy

Every user-facing string this feature adds or changes. Group letters match the Carry-forward table. After each group, one line each for the four checks (Residuals, Source of truth, Audience, Neighbours). The reader of every public string is an anonymous or signed-in visitor of any role; the reader of every admin string holds `admin.tickets` (roles `admin` and `support_operator`).

### A. The form page (`/help/contact`, in `src/lib/help-contact/copy.ts`)

| Element | String |
|---|---|
| Page title (h1, metadata) | Contact the PresbyPortal team |
| Intro, paragraph 1 | Write to the PresbyPortal team. You do not need an account. A person reads every message. |
| Intro, paragraph 2 | We do not send an automatic reply, and we cannot promise a reply or a time. If we reply, it comes by email from a person. |
| Topic label | What is this about? |
| Topic placeholder (first option) | Choose a topic |
| Topic options (keys `starting_a_congregation`, `signing_in`, `help_page_wrong`, `something_else`) | Starting a congregation / I can't sign in or I lost my codes / A help page is wrong / Something else |
| Name label | Your name (optional) |
| Email label | Your email address |
| Email helper | So we can reply. We do not send anything to this address automatically. |
| Congregation label | Your congregation (optional) |
| Message label | Your message |
| Message helper | At least 10 characters. Please do not include passwords or recovery codes. |
| Counter | {n} of 2,000 characters |
| Counter, announced at 1,800 and 2,000 (visually hidden) | {n} of 2,000 characters used. / You have reached the 2,000 character limit. |
| Honeypot label (off-screen) | Leave this field blank |
| Privacy notice (above the button) | The team reads your message. We keep your name if you give it, your email address, your congregation if you give it, the topic, your message and the time you sent it. We do not store your IP address or browser details with the message. To slow down abuse we count messages by IP address for a short time, and Cloudflare Turnstile checks that you are a person. Do not include passwords, recovery codes, or private details about other people. See the privacy policy. |
| Privacy link text (links to the privacy policy through `helpHref("privacy-policy")`) | privacy policy |
| Button | Send message |
| Button, pending | Sending… |
| Reason line while the button is disabled | Waiting for the check to finish… |
| Error summary heading | Your message was not sent. Fix these first: |

- *Residuals:* it never says "we never record your IP". It says the message is stored without one, names the short-lived IP count and Turnstile, and so cannot deny the refusal audit rows (they carry no IP) or the provider logs the privacy policy names (AF-2, CA5, F170).
- *Source of truth:* "We keep …" is the column list of `help_contact_messages` (Data Model); "We do not store your IP address or browser details with the message" is the absence of such a column (live-catalog proof in QA); "The team reads your message" is an operator duty (runbook 2), not a query; "We do not send anything to this address automatically" is pinned by the test that no queue row's `to` is the typed address.
- *Audience:* an anonymous or signed-in visitor, any role; the only instruction is to avoid passwords and recovery codes, which anyone can do.
- *Neighbours:* grep of `contact`, `message`, `reply`, `support` across `src/` and `src/content/help` found no string this makes stale; the congregation website form's own strings (`src/app/(public)/site/[slug]/contact-form.tsx`, "Someone will follow up soon.") and `src/app/(org)/o/[slug]/tickets/site-messages-list.tsx:40` are a different surface and stay.

### B. Outcomes and field errors

| Outcome or error | String |
|---|---|
| `sent`, heading | Your message was sent. |
| `sent`, body | The PresbyPortal team has it, and a person reads each message. We do not send an automatic reply, so you will not get a confirmation email. We cannot promise a reply or a time. If we reply, it comes by email from a person. |
| `sent`, extra paragraph when the topic was `signing_in` | A message cannot reset anything by itself. If your message is about an account, we reply to the email address on that account, which may not be the one you typed here. |
| `sent`, link | Back to the help index |
| `invalid`, topic | Choose what this is about. |
| `invalid`, email required | Enter your email address so we can reply. |
| `invalid`, email bad_format | That does not look like an email address. Check for a missing @ or a typing mistake. |
| `invalid`, email too_long | That email address is too long. The limit is 254 characters. |
| `invalid`, message required / too_short | Write a message of at least 10 characters. |
| `invalid`, message too_long | Your message is {n} characters. The limit is 2,000. Shorten it and send it again. |
| `invalid`, name too_long | Your name is too long. The limit is 100 characters. |
| `invalid`, congregation too_long | The congregation name is too long. The limit is 150 characters. |
| `check_failed` | We could not confirm that you are a person. Please try again. |
| `busy` | We can't take messages right now. Please try again later. |
| `not_sent` | We couldn't send your message. Your text is still here, so you can try again in a few minutes. |

- *Residuals:* `not_sent` does not claim "nothing was saved" (a response lost after the commit could leave a stored row, so a duplicate is possible and accepted); `busy` is the one neutral sentence for all three limits, so it does not admit which limit tripped, and does not deny a residual (a flooded global ceiling blocks honest senders, which the sentence honestly allows). The `signing_in` paragraph promises nothing but a reply path and denies no Phase 2 ruling (a message is never authority).
- *Source of truth:* "a person reads each message" is the operator duty; "you will not get a confirmation email" is the C5 test; "we reply to the email address on that account" is runbook 2 step 2, an operator duty (no query backs it, so the sentence says "we reply", not "we have found your account"); the limits quoted (254, 100, 150, 10, 2,000) are `HELP_CONTACT_LIMITS`, imported, not retyped.
- *Audience:* the visitor. `busy` and `not_sent` instruct only "try again"; the exit block under `busy` carries the other routes (Copy C).
- *Neighbours:* none contradicted; `getting-help.md:32` ("There is no promised reply time") stays true.

### C. Unavailable, "check didn't load", no-JavaScript, and the shared exit block

| Element | String |
|---|---|
| Unavailable heading | The contact form isn't available right now |
| Unavailable body | You can still reach us another way. |
| Exit line 1 | If someone invited you, ask the person who invited you. |
| Exit line 2 | Or open an issue on the [PresbyPortal repository](https://github.com/chenson42/presby). Issues there are public, so leave out personal details, passwords and recovery codes. You need a GitHub account. |
| "Check didn't load" note | The check that confirms you are a person did not load. Turn off any content blocker for this page, or try another browser. |
| No-JavaScript note (`<noscript>`) | This form needs JavaScript to run its check. Turn JavaScript on, or reach us another way. |

The exit block (lines 1 and 2) renders under the unavailable heading, under the "check didn't load" note, under `busy`, and in `<noscript>`. The repository sentence reuses `HELP_REPOSITORY_URL` exported from `src/lib/help/contact.ts` (the same URL as `HELP_PRIVACY_CONTACT_FALLBACK` and `EXTERNAL_LINK_ALLOWLIST`; a test pins that it is in the allowlist).

- *Residuals:* no claim about when the form returns, and "isn't available right now" does not deny that it may be off on purpose (the kill switch).
- *Source of truth:* "isn't available" is `isHelpContactConfigured` false, the host refusal, or `42501`; "Issues there are public" is GitHub's behaviour, already stated by `HELP_PRIVACY_CONTACT_FALLBACK`.
- *Audience:* any visitor; "ask the person who invited you" is conditional ("If someone invited you") so a prospect with no inviter is not told to do the impossible; the GitHub route needs an account, and says so.
- *Neighbours:* `HELP_PRIVACY_CONTACT_FALLBACK` (`src/lib/help/contact.ts:16`) is the same sentence shape and stays; `how-a-congregation-gets-started.md:23` is the old GitHub-only sentence and is replaced (Copy H).

### D. The inbox (`/admin/messages`, admin; strings in `copy.ts`)

| Element | String |
|---|---|
| Nav label, dashboard card title, page h1 | Contact messages |
| Page intro | Messages people sent through the contact form on the help pages. Anyone can send one, so treat every address as unverified. |
| Filter links | New / Handled / Spam / All |
| Count line | {n} message shown, newest first. / {n} messages shown, newest first. |
| Empty, New / Handled / Spam / All | No new messages. / No handled messages. / No messages marked as spam. / No messages yet. Messages from the contact form appear here. |
| Card, no name | No name given |
| Card link | Read message |
| Older link | Older messages |
| Status badges | New / Handled / Spam / Details cleared |
| Load error (title, body) | Messages could not be loaded / Something went wrong reading the contact messages. Try again. |
| No permission | You don't have permission to view this page. |
| Detail labels | Sent / Topic / Name / Email / Congregation / Message |
| Not given | Not given |
| Cleared field | Cleared |
| Email caption | Not verified. Anyone could have typed this address. |
| Guidance under the fields | Do not act on a role, access or sign-in request from this message alone. To reply about an account, use the address on the account itself, not this one. An administrator can look it up under Users & roles. |
| Stamp line | Last changed to {Status} by {name} on {date}. (name falls back to "an operator") |
| Cleared line | Details cleared by {name} on {date}. |
| Status buttons | Mark as handled / Mark as spam / Move back to new |
| Status toasts | Marked as handled. / Marked as spam. / Moved back to new. |
| Status failure | Could not change the status. Try again. |
| Clear button | Clear details |
| Clear hint when status is New | Mark the message as handled or spam before clearing its details. |
| Dialog title | Clear this message's details? |
| Dialog body | This removes the name, email address, congregation and message text from this record. The record stays, with its topic, its dates and its status. This cannot be undone. |
| Dialog buttons | Clear details / Keep details |
| Clear toast / failure | Details cleared. / Could not clear the details. Try again. |
| Action refusals | Not signed in. / Forbidden. / That message could not be found. / Its details were already cleared. / Mark the message as handled or spam before clearing its details. / A message whose details were cleared cannot go back to new. |
| Dashboard card headline | {n} new (or the all-clear the other cards use) |

- *Residuals:* "This cannot be undone" is true (the guard refuses an un-clear) and "The record stays" does not deny that audit rows about the message remain (they hold ids and statuses only). "Treat every address as unverified" admits the paper residual that a typed address can be anyone's.
- *Source of truth:* the date and the stamp names come from `created_at`, `status_changed_at` and `users.name` through `status_changed_by` / `cleared_by` (`readMessage` joins them; a null name falls back to "an operator"); "Not given" is a null column; "Cleared" is `cleared_at is not null`; the count is `listMessages`. "Last changed to" reads `status_changed_*`, which is null for a message never triaged, so that line is omitted rather than invented.
- *Audience:* holders of `admin.tickets`. Every instruction is doable by them: the status and clear buttons are gated by that same key. The guidance "An administrator can look it up under Users & roles" names a route a `support_operator` may lack (`admin.users`), which is why the sentence hands it to "an administrator" rather than telling the reader to do it.
- *Neighbours:* grep of `Feedback`, `feedback`, `Tickets` in `src/lib/admin-portal/nav.ts` and the dashboard registry: the existing "Feedback" nav item and card (member feedback) are a different subject and stay; the new label is "Contact messages" so the two are not confused.

### E. The notification email (`help_contact_notification`, constant, no submitter text)

| Element | String |
|---|---|
| Subject | New message on the PresbyPortal contact form |
| Preheader | Open the inbox to read it. |
| Heading | A new contact message |
| Paragraph 1 | Someone sent a message to the PresbyPortal team through the contact form. The message is not in this email. |
| Paragraph 2 | You get this email at most once an hour, however many messages arrive. Open the inbox to read them. |
| Button (to `<platformOrigin>/admin/messages`) | Open contact messages |
| Footnote | You are receiving this because your account can work tickets and contact messages. |

- *Residuals:* "at most once an hour" is an upper bound and stays true when a failed enqueue drops a window's email; it does not promise an email per message.
- *Source of truth:* "once an hour" is the definer's `c_window = 60 minutes` (the DB test pins it); the recipients are `getTicketOperatorPool()`, so "your account can work tickets" is the same query that chose the recipient.
- *Audience:* operators holding `admin.tickets`; the button needs that same key, so it opens for each recipient.
- *Neighbours:* `ticket_new` and `feedback_notification` emails are a different subject and stay. No string anywhere else describes this email.

### F. The contact line and the 13 readers (`src/lib/help/contact.ts`)

New exports: `HELP_CONTACT_HREF = "/help/contact"` (in `urls.ts`), `HELP_REPOSITORY_URL`, and:

- `HELP_CONTACT_LINE`: Ask the person who invited you, or [send the PresbyPortal team a message](/help/contact).
- `HELP_CONTACT_ADMIN_LINE` (token `{{contactAdmin}}`): File a ticket: open Administration, then Tickets (see [Getting help](/help/getting-help) for the steps). If you cannot file one, [send the PresbyPortal team a message](/help/contact).
- `switchedOnText(name)` (the latent Needs-block row, plain text, no link): The PresbyPortal team turns on "{name}" for you. To ask for it, file a ticket (Administration, then Tickets) or ask the person who invited you.

Why a second token: a founding administrator's inviter is the PresbyPortal team itself, so "ask the person who invited you" is circular for them, and a ticket has a verified identity and a reply thread. Token machinery: `tokens.ts` `KNOWN_TOKENS` and `applyHelpTokens(markdown, contact, privacyContact, contactAdmin)`; `checks.ts` passes the default for each.

Each of the 13 readers, read as its reader (file:line is the `{{contact}}` today):

| # | file:line | Reader | Becomes |
|---|---|---|---|
| 1 | `getting-help.md:5` | anyone | prose, no token (Copy G) |
| 2 | `why-cant-i-see-this.md:56` ("A feature is not in Features") | an administrator, who alone has a Features page | `{{contactAdmin}}` |
| 3 | `turning-features-on-and-off.md:50` | an administrator | `{{contactAdmin}}` |
| 4 | `roles-who-can-do-what.md:67` | the founding administrator | `{{contactAdmin}}` |
| 5 | `reimbursements-for-treasurers.md:81` | the person who sees the queue message: a treasurer or the church office; the page audience is "treasurer", who may not be an administrator | `{{contact}}` (judgment call: an administrator-only line would send a non-administrator treasurer to a ticket they cannot file) |
| 6 | `accepting-your-invitation.md:37` | an invitee with a dead link, possibly signed out and with no account | the sentence just before already says "ask whoever invited you to send a new one", so the token would repeat it; replace the trailing token with: If whoever invited you cannot help, [send the PresbyPortal team a message](/help/contact). |
| 7 | `your-congregations-website.md:20` | the founding administrator | `{{contactAdmin}}` |
| 8 | `your-congregations-website.md:44` | an administrator | `{{contactAdmin}}` |
| 9 | `who-is-asked-for-a-code.md:52` (under "Questions") | anyone signed in or mid-enrolment | `{{contact}}` |
| 10 | `first-day-as-administrator.md:47` | the founding administrator | `{{contactAdmin}}` |
| 11 | `first-day-as-administrator.md:59` ("ask for that role.") | the founding administrator | `{{contactAdmin}}` |
| 12 | `events-and-the-calendar.md:17` | the founding administrator | `{{contactAdmin}}` |
| 13 | `signing-in.md:55` (deactivated account) | a person who cannot sign in, so cannot file a ticket; the form is public and session-free | `{{contact}}` |

So eight lines take `{{contactAdmin}}`, three keep `{{contact}}`, one is a literal sentence, one is prose: 13. The Needs block is a 14th reader (latent) and takes `switchedOnText`.

- *Residuals:* neither line promises a reply, a time, or that the inviter exists; "if you cannot file one" admits an administrator without the ticket permission.
- *Source of truth:* "File a ticket: open Administration, then Tickets" is `getting-help.md:17-22` (Administration, then Tickets, then File a ticket), which Phase 6 re-walks; whether a given administrator holds the role is not read, hence "If you cannot file one".
- *Audience:* the `{{contactAdmin}}` lines sit only where the reader is an administrator (2, 3, 4, 7, 8, 10, 11, 12: a person who sees the Features page, Manage events or Branding is one); a Founding Administrator can file tickets (`getting-help.md:19`). The three default lines (5, 9, 13) are for readers who may have no administrator role.
- *Neighbours:* grep `ticket`, `ask`, `support` across `src/content/help`: `adding-people.md:70`, `your-congregations-website.md:12` and `sign-in-invitations.md:42` ("send a support ticket", administrator readers) stay true and unchanged. In-app strings "Contact the person who invited you." (`src/lib/onboarding/labels.ts:67-79`, `confirm-state.tsx:30`, `no-organization-copy.ts:38`) stay true; linking them to the form is a follow-up (out of scope). `src/lib/domains/notify.ts:239` ("contact PresbyPortal support", to an administrator) stays. `src/lib/help/contact.ts:2-4` header comment is rewritten (it says "Increment 2 changes this one constant").

### G. `getting-help` (`src/content/help/getting-help.md`)

- Intro (line 1): There are four ways to get help: ask the person who invited you, write to the PresbyPortal team, send feedback, or file a ticket. This page says what each one is for and who reads it.
- "Ask the person who invited you" (replaces line 5): For a question about your own congregation, the person who invited you or your church administrator is the right person to ask. They can see your congregation's settings and people.
- New section "Write to the PresbyPortal team", before "Send feedback":
  > You do not need an account. Open the [contact form](/help/contact). Under "What is this about?" choose a topic, give your email address under "Your email address", write your "Your message" and select "Send message". The page says "Your message was sent."
  >
  > Use it when you cannot sign in, when you have no one to ask, or when you want to ask about starting a congregation. A person on the PresbyPortal team reads each message. There is no automatic reply and no promised time. If we reply, it is by email from a person. Do not put passwords or recovery codes in a message.
  >
  > A message is not proof of who you are. The team does not change anyone's account, role or sign-in because of a message alone. For anything about an account, we reply to the email address on that account, which may not be the one you typed in the form.
  >
  > This is not a ticket. A ticket is for a signed-in church administrator, has a reply thread and belongs to your congregation. A contact message is one note to the team and belongs to no congregation.
- "What to expect" (replaces the one sentence): The PresbyPortal team is told about every new ticket and every piece of feedback it receives. A contact message is read when someone on the team opens the inbox. There is no promised reply time for tickets, feedback or contact messages.
- Registry entry `getting-help`: `summary` becomes "How to ask a question, write to the team, report a problem or send feedback."; `covers` gains `route:/help/contact`; `labels` gains "What is this about?", "Your email address", "Your message", "Send message", "Your message was sent." (each is in the island's source and quoted above, so H10 holds).

- *Residuals:* "we reply to the email address on that account" is an operator duty, stated as the intended practice, not as a query, and does not deny that a reply to a typed address is normal for a prospect (Copy H is a different topic). "A person on the PresbyPortal team reads each message" is the operator duty.
- *Source of truth:* "belongs to your congregation" is `tickets.organization_id NOT NULL` (C2); "has a reply thread" is the existing "Send reply" in this page; the form labels are `copy.ts`.
- *Audience:* anyone; the ticket route is addressed to "a signed-in church administrator", who alone can file one (`getting-help.md:19`).
- *Neighbours:* line 1 ("three ways"), lines 3-5, and the "What to expect" sentence (line 32) are all modified here; no other page says "three ways".

### H. `how-a-congregation-gets-started` (replaces line 23 and its heading's body)

> There is no sign-up form, but you can write to the PresbyPortal team. Open the [contact form](/help/contact) and choose "Starting a congregation" under "What is this about?". Say your congregation's name and who the first administrator would be; a name is enough. A person reads each message. There is no automatic reply and no promised time, and a message does not create an account or set anything up by itself.

Registry: `labels` gains "Starting a congregation" and "What is this about?".

- *Residuals:* it says a message creates nothing by itself, so it does not imply a sign-up path that the first paragraph ("There is no sign-up form") denies.
- *Source of truth:* the topic label is `copy.ts`; "a person reads each message" is the operator duty.
- *Audience:* a prospective congregation, anonymous.
- *Neighbours:* the replaced sentence (line 23) said "PresbyPortal does not have a contact form" and pointed only to GitHub: false after this change and removed. The marketing home page's "Get involved" (`src/app/page.tsx:324`) is about the open-source repository, not starting a congregation, and is left as is (Q8).

### I. `privacy-policy` (required edits)

1. Line 1: "Last updated October 28, 2026." becomes the ship date in the same format.
2. "Other information we record", "Abuse protection": append **This includes messages sent through the contact form.**
3. Same list, "Messages to us": replace with **Messages to us.** Feedback and tickets you send. Feedback sent from inside a congregation goes first to a person at that congregation. Messages sent through the PresbyPortal contact form go to the PresbyPortal team, not to a congregation, and you do not need an account to send one. We keep the topic you chose, your email address, your message, the time you sent it, and your name and congregation if you gave them. We do not store your IP address or browser details with the message. Do not put passwords or recovery codes in a message.
4. "Other companies", Cloudflare Turnstile: append **It runs on the contact form.**
5. "How long we keep information": add **Messages sent through the contact form** are kept until we clear them. We clear a message when you ask, and when we have finished with it. Clearing removes the name, email address, congregation and message text; a record that a message arrived, with its topic and its dates, stays. There is no fixed period.
6. "What you can ask us to do": add a bullet: clear a message you sent through the contact form. Say which one: its topic and about when you sent it.
7. "Questions and requests": after the `{{privacyContact}}` line add **For anything else, use the [contact form](/help/contact).**
8. Line 42 ("Messages sent through a congregation's website contact form go to that congregation.") is unchanged and stays true.

- *Residuals:* it never says "we never record your IP": the new text says the message is stored without one, the existing "Abuse protection" bullet and the Turnstile bullet still say IPs are counted and received, and "Audit records … along with the IP address and browser type of the request" still describes the triage rows (refusal rows carry none; the policy does not claim they do). "There is no fixed period" matches Q4 and the absence of a sweep; the operator-duty clause "when we have finished with it" is the Q4 default wording the operator confirmed.
- *Source of truth:* the kept columns are the table's; the retention sentence is true only while no sweep ships and while "Clear details" blanks exactly name, email, congregation and message (CHECK `help_contact_cleared_shape`); Phase 6 confirms the sentence against the shipped behaviour.
- *Audience:* anyone reading the policy; "ask us" routes through `{{privacyContact}}` (and, when that is unset, the existing GitHub fallback, which is public: a known weakness for a clear-on-ask request; the operator confirms `HELP_PRIVACY_CONTACT_EMAIL` is set in Production, question below).
- *Neighbours:* lines read: 1, 42, 47, 49, 69, 75-80 (retention), 82-90 (asks), 106 (questions). Line 42 stays; lines 1, 47, 49, 69, the retention list, the asks list and 106 are modified as above; `src/lib/help/contact.ts:16` (the fallback) stays.

### J. Lost-phone sentences

`using-your-code.md:30` and `setting-up-two-factor.md:46` each keep their current text and append (identical on both pages):

> If you are the only administrator and have no one to ask, [write to the PresbyPortal team](/help/contact) and choose "I can't sign in or I lost my codes" under "What is this about?". A message cannot reset anything by itself. The team uses the email address on your account to check with you, and that address may not be the one you type in the form.

Registry: both entries gain labels "I can't sign in or I lost my codes" and "What is this about?".

- *Residuals:* it promises a check, not a recovery ("cannot reset anything by itself"), so it denies nothing F374 or Q3 ruled.
- *Source of truth:* "the team uses the email address on your account" is runbook 2 step 3, an operator duty; no query backs it for the reader, so the sentence describes what the team does, not that an account was found.
- *Audience:* a person who cannot get past the code page: signed out, mid-enrolment or locked out; the form works for them (proxy bypass, no session).
- *Neighbours:* the two existing sentences ("Ask a church administrator to send the team a support ticket for you", for the reader who has an administrator) stay true and stay; no other page says how to recover two-factor.

### K. Help chrome

| Element | String |
|---|---|
| Footer, on every help page (the layout; index and 404 included, so no separate lines are added there) | Can't find what you need? [Write to the PresbyPortal team](/help/contact) |
| Footer link text (`HELP_COPY.footerContactLink`) / lead (`HELP_COPY.footerContactLead`) | Write to the PresbyPortal team / Can't find what you need? |

The footer is `print:hidden`, the link `min-h-11`, and its text names the destination rather than saying "Contact us" so it reads correctly out of context (H6's rule for link text). Deliberate simplification of the brief's "index, 404 and footer": the layout wraps all three, so one footer covers them without a duplicate line on the index or the 404 body; the orchestrator can ask for the extra lines.

- *Residuals:* none claimed.
- *Source of truth:* a static link; the form's availability is not claimed (the unavailable block carries its own exit).
- *Audience:* anyone on a help page.
- *Neighbours:* `HELP_COPY.indexNote` ("tell the person who invited you", `src/lib/help/copy.ts:19`) is about a screen that differs from the page, still true, unchanged.

### L. Dashboard and nav

The dashboard card title and the nav label are "Contact messages" (Copy D). Neighbours: "Feedback" card and nav stay.

## Help impact

Workflow Rule 17 applies (a public route, a string a help page quotes, an email-adjacent promise, a bug-fix-class correction of two stale sentences). No `[help:<token>]` is needed (ordinary case): the branch edits its pages as `published` in the same PR. Pages edited, with the Copy rows that feed each:

| Slug | Edit | Copy |
|---|---|---|
| `getting-help` | four ways; new section; "What to expect"; registry summary, covers, labels | G |
| `how-a-congregation-gets-started` | replace the GitHub-only sentence; labels | H |
| `privacy-policy` | seven edits | I |
| `using-your-code` | lost-phone paragraph; labels | J |
| `setting-up-two-factor` | lost-phone paragraph; labels | J |
| `why-cant-i-see-this`, `turning-features-on-and-off`, `roles-who-can-do-what`, `your-congregations-website` (2), `first-day-as-administrator` (2), `events-and-the-calendar` | `{{contact}}` becomes `{{contactAdmin}}` | F |
| `reimbursements-for-treasurers`, `who-is-asked-for-a-code`, `signing-in` | no text edit: the token's expansion changes | F |
| `accepting-your-invitation` | the trailing token becomes a literal sentence | F |

Not changed: no placeholder is retired; no token is released; the `limitationUntil` sentences found by grep (`email-change-error`, `person-photos`, `founder-events-branding` ×3, `phone-public-listing`) concern other features and none concerns this one. `verifiedIn` moves only by the Phase 6 walk of each page at 360px. At ship also: `docs/product/functionality-map.md` (the help and admin-support bullets), the release note, `docs/deployment.md`.

## Operator runbook (for `docs/deployment.md`, new section "Help contact form (0083)")

**1. Ship order (FC9).** The help sentences link to the form, so the form must work in Production before the code is live.
1. Confirm what Production already has, read-only (`vercel env ls production`): `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `HELP_PRIVACY_CONTACT_EMAIL`. `RATE_LIMIT_DISABLED` must be absent.
2. Set any that are missing, in the **Production scope only**, with a real Cloudflare widget whose allowed hostnames include the production host. **Cloudflare's published test keys (`1x…`, `2x…`, `3x…`) are never set in Production**; the code refuses them in a production deployment and the form shows "unavailable", but do not rely on that. These variables also switch the Turnstile check **on at sign-in, forgot-password and the public giving form**, and the Upstash limiter on for every limiter. If they are new, walk each of those three after the deploy.
3. Apply `0083` to production, additive (a new table, three guard functions and one definer; nothing reads them until the code ships): the standard endpoint-swap of `MIGRATE_DATABASE_URL`, `psql -1` as owner. Then run the catalog proof: `relforcerowsecurity = t`; zero `pg_policies` rows for the table; `aclexplode(relacl)` shows no `presby_app` and no PUBLIC entry; `has_function_privilege('presby_app', 'presby_submit_help_contact(text,text,text,text,text)', 'execute')` true and the same for `public` false.
4. Merge and deploy. The site key is baked in at build, so the variables must be set before this build.
5. Walk it in Production: the form at 360px; send one message with an obvious marker; see the dashboard card say "1 new" and the notification email arrive once; read it in `/admin/messages`; reply by hand; mark it handled; clear its details. Preview deployments show "unavailable" because the keys are Production-scope: expected.

**2. Handling a message (FC2).** A message is a claim, never proof.
1. Never act on a role, access, sign-in, invitation or two-factor request from a message alone ("I am the administrator at X").
2. For anything about an account, reply to the address on the account itself (looked up under Users & roles; that needs `admin.users`, so a `support_operator` asks an administrator), never to the typed address.
3. For a lost phone and lost codes, act only after the account's own address replies to you; then use "Force-reset 2FA enrollment" on that user's page (it writes `user.2fa_force_reset`). Whether a reply from the mailbox is enough proof is your standard to set.
4. For a prospective congregation (`starting_a_congregation`), replying to the typed address is ordinary correspondence; treat who they say they are as unverified until a conversation settles it, and send an invitation only to an address you chose yourself.
5. Prefer the ticket route for a signed-in administrator: a ticket has a verified identity and a reply thread.
6. Triage: Mark as handled or Mark as spam. Clear details when you have finished with a message and whenever someone asks (the privacy policy promises both); it is irreversible. Rows are never deleted.

**3. Reading what happened.** Limiter refusals appear in `/admin/audit` as `rate_limit.blocked` with a resource id beginning `help_contact:`, at most one per kind per hour, with no IP. Status changes and clears appear as `help_contact.status_changed` and `help_contact.details_cleared` (ids and statuses only).

**4. Switching it off (CA6, DECISION-303).** Nothing here is instant except lever A.
- **Durable:** remove the Turnstile or Upstash variables in Production **and redeploy**. Vercel applies variable changes to new deployments only. Note this also turns the Turnstile check off at sign-in, forgot-password and giving, so it is a heavy lever.
- **Immediate lever A (verified by the DB test):** as owner, `revoke execute on function presby_submit_help_contact(text, text, text, text, text) from presby_app;`. The next submission shows "The contact form isn't available right now" (the action maps SQLSTATE `42501`). Restore with the same statement as `grant execute … to presby_app`. The page still shows the form until a redeploy.
- **Lever B, unverified and not recommended:** removing the production host from the Turnstile widget's allowed hostnames in Cloudflare would stop the widget at sign-in, forgot-password and giving as well, and the sign-in form keeps submit disabled without a token, so nobody could sign in. Use it only after walking the effect on a non-production host.
- **A flood:** the limiter (3 per hour per IP, 30 per hour and 100 per day overall) and the database ceiling (90 per hour, 300 per day) cap the damage; mark the junk as spam. The per-IP limit is a courtesy while `cf-connecting-ip` is unverified on Vercel (F407).
- **A Cloudflare outage** lets submissions through without the check (fail-open, DECISION-026); the same ceilings bound it.

**5. Dev and e2e.** Cloudflare's public test keys (`docs/testing.md`) go in a gitignored `.env.local` or a Playwright server's environment, never in a Vercel scope.

## Proposed final text: DECISION-300 to 304 (the orchestrator records them; newest first)

**DECISION-304 — The public documentation boundary's one database-reaching file is `src/app/(documentation)/help/contact/actions.ts`, named exactly.** It is a `"use server"` stop in H19's import walk: reached, counted, not followed, required to begin with `"use server"`, and importable only from its own segment. `page.tsx` and `contact-form.tsx` stay H19 entries and are walked with everything they import. `checkImportBoundary` gains an optional `stopAt` (default empty; `check:proxy-imports` is unchanged); `help-boundary.mjs` drops the `help/contact/` subtree `EXEMPT` and gains `SERVER_ACTION_STOPS`, one file. `shell-boundaries.test.ts` excludes that one path, pins its imports to `next/headers`, `next/server`, `@/lib/help-contact/*` and `@/types/actions`, and pins that it exports one function. The `loading.tsx` and `error.tsx` bans keep no carve-out. Replaces the subtree exemption recorded in DECISION-293's R8. Why: the exemption exempted the page and the island too, which are exactly what must stay checked. `paper`: the walk sees specifiers, not `eval`.

**DECISION-303 — The form's availability is a pure configured-check, and the action refuses off the platform host.** `isHelpContactConfigured(env)` requires the Turnstile pair in every environment and, in a production deployment, both Upstash variables, the limiter enabled, and no Cloudflare dummy key. The page evaluates it at build; the action at runtime, returning `unavailable`. The action also returns `unavailable` unless `isPlatformHost(requestHost(headers()))`. On Vercel, removing variables takes effect only at the next deployment; the immediate lever is revoking EXECUTE on `presby_submit_help_contact`, which the action maps from SQLSTATE `42501`. Amends C10's "immediate" claim. Live-form e2e runs in its own lane with Cloudflare's public test keys in that server's environment only, because setting the site key disables the sign-in form's submit for every other spec. Why: `verifyTurnstile` is a no-op when unconfigured (the starter default), which must not become this form's posture. Accepted: a Cloudflare outage fails open (DECISION-026), bounded by the ceilings. `paper`: a dummy key is refused only in a production deployment.

**DECISION-302 — `src/lib/rate-limit.ts` exposes `consumeRateLimit` (no audit) and `recordRateLimitBlock`; `checkRateLimit` is their unchanged composition.** The contact form audits a limiter refusal at most once per kind per hour, with keys that carry no IP; it skips the per-IP check when no usable IP is known (a value that is not IP-shaped counts as none), places the global ceiling after Turnstile, and is backed by a database ceiling inside the definer (90 per hour, 300 per day). Because `cf-connecting-ip` is not proven unspoofable on Vercel (F407), the per-IP limit is a courtesy and the bound is Turnstile plus the global and database ceilings. An Upstash error fails closed as "not sent". Why: `checkRateLimit` writes an audit row on every blocked call, which turns a flood into an unbounded, forever-kept audit-table flood.

**DECISION-301 — Notification coalescing is claimed inside the definer.** `presby_submit_help_contact` takes `pg_advisory_xact_lock(hashtextextended('help_contact_messages', 0))`, counts for the ceiling, then sets `notified_at = now()` on the new row only if no row has one within `c_window` (a SQL constant, 60 minutes), returning `'stored_notify'`. Recipients are the holders of `FEATURES.ADMIN_TICKETS` through `getTicketOperatorPool()`. The content-free queue rows are inserted before the response; only the provider attempt runs in `after()`; the 5-minute email-queue cron is the durable backstop; no fifth cron. Template `help_contact_notification` is classified `account`. Accepted: a failed enqueue loses that window's notification (the dashboard card is the backstop). Why: exact across serverless instances, needs no read privilege, no second table and no cron; "first message after a quiet hour" would let a steady trickle suppress every later notification, and running the provider call inline only for the claiming submission would leak the claim through latency (AF-4).

**DECISION-300 — The help contact form writes to a definer-only platform-axis table, `help_contact_messages` (migration 0083).** `presby_app` holds no table privilege and reaches it only through `presby_submit_help_contact(text,text,text,text,text)`, `SECURITY DEFINER`, revoked from PUBLIC, executable by `presby_app` only, returning a closed token (`stored`, `stored_notify`, `ceiling`): no id, no content. FORCE RLS with no policy is a deliberate deny-all. DELETE is revoked and a `BEFORE DELETE` guard covers the owner path. A `BEFORE UPDATE` guard allows only status changes (stamps forced) and one irreversible clear (name, email, congregation and message to null; refused while the status is `new`; a cleared row never returns to `new`). Reads and triage happen only in `src/lib/help-contact/inbox.ts` through `getPlatformDb()`, each mutation with its audit row in one transaction carrying ids and statuses only, never a personal field. No IP, user agent, organization, person or sender id is stored. Amends C1 of the user-help parent: not `schema.ts` and no INSERT-only grant, because the live catalog has no INSERT-only precedent and `RETURNING` needs SELECT. `database` for the grants, the guards and the CHECKs; `paper` for the owner path's ability to insert a non-born-new row.

Two implementation decisions this design adds beyond the pre-assigned block, for the orchestrator to number or fold: (a) a second help token `{{contactAdmin}}` and a plain-text Needs-block sentence, so readers who are administrators are told the ticket route; (b) the dedicated contact e2e lane (`PW_HELP_CONTACT=1`, own server, own `globalSetup`, no sign-in), the pattern `PW_HELP_SHOTS` and `PW_VISUAL` already set. Folded into DECISION-303 above for (b); (a) has no home in 300 to 304 and needs a number or a line in the release note.

## Implementer

**database-admin** for Batch 1 (migration `0083`, its mirror, its DB tests and `test-rls-83.sql`). **full-stack-developer** for Batches 2 to 5 (the server half; the public page and e2e lane; the admin inbox; help content and chrome). The architect's suggested split is adopted. Batch 1 first.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — Technical design | tech-lead | Complete (Batches 1 to 5; DECISION-300 to 304 text drafted; runbook drafted) | Design complete, implementer named | 2026-10-31 |

## Handoff note

**Next agent: database-admin (Batch 1).** Read, before writing SQL: the Data Model section above, `drizzle/0059_presby_account_invitations.sql` sections 3 and 4 (guards, grants), `src/lib/db/domain/careers.db.test.ts` (the rolled-back-transaction and two-connection patterns) and `scripts/careers/test-rls-71.sql`. Do not edit `drizzle/meta/_journal.json`, `src/lib/db/domain/index.ts`, `scripts/test-rls.sql` or `scripts/seed-dev.sql` (Rule 16). Apply to the pipeline branch with `psql -1` as owner; paste the live-catalog proof into Phase 4. Stop for a ruling if a CHECK regex literal does not behave as specified.

**Questions that need the operator** (none blocks Batch 1):
1. Are the Turnstile and Upstash variables already set in Production (so sign-in, forgot-password and giving already show the check)? If not, setting them for this form is a sitewide change; the runbook says to walk those three forms after the deploy.
2. Is `HELP_PRIVACY_CONTACT_EMAIL` set in Production? The privacy policy's clear-on-ask request routes through it, and the fallback (a public GitHub issue) is a poor channel for it.
3. The `{{contactAdmin}}` token needs a decision number (see the end of the decisions block) or a line in the release note; the orchestrator's call.


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
