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
| 3 — Technical design | tech-lead | In progress | — | 2026-10-31 |
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
