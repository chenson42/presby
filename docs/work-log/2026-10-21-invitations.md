# Invitations for people without an account — Work Log

> **Slug:** `2026-10-21-invitations`
> **Surface:** mixed — invitation acceptance (auth-adjacent, platform chrome); platform admin designations; org admin staff/roles
> **Permission(s):** none new — existing `admin.organizations` covers sending, resending, revoking; acceptance is token-gated (DECISION-147/183)
> **Flag(s):** none — no new platform flag (operator rule), no per-org toggle needed (Phase 3)
> **Estimated complexity:** medium-to-large (auth-touching)
> **Pipeline mode:** Full

## Kickoff (orchestrator, 2026-10-21)

**Trigger (operator, during the production test run):** "i tried to designate a treasurer and it said the account did not exist yet on presby portal." Platform designations (treasurer, DECISION-170; founding administrator, DECISION-155) look a person up by email and refuse `no_such_user`; there is no self sign-up and no invitation, so a real person can only be onboarded by an operator creating their account by hand (done once in production on 2026-10-21 as a stopgap: account created with a random discarded password, audited `platform.user.bootstrapped`, the person sets their own password via /forgot-password). Operator: "lets do both … queue up the invitation flow as well … keep going with that feature."

**Backlog line this pipeline closes (`docs/TODO.md`):** "Invitation flow for a person with no account (founding-administrator Flow 2 / G4). The second person a founding administrator creates through Staff has no login and cannot sign in; a designee with no account must self-register first ("sign up first, then be designated by email"). Build token + email-queue invite plus signup-time linking."

**Shape to refine in Phase 1:** designating or granting to an email with no account sends an invitation (not a refusal); the link lets the person set a password and enrol 2FA, then lands them in the right place with the pending designation/grant applied; it covers at least the platform designations (founding administrator, treasurer) and people an org adds through Staff/Roles; account mail stays on the platform domain (Track F rule); tokens single-use, expiring, hashed at rest; no enumeration of who has an account; works with the 2FA requirement and the post-login router (`/launch`); Google sign-in (not yet configured) must link to the same pending invitation when it lands.

**Constraints:** auth-touching (the Phase 4/5 MFA e2e gate applies); No Real Data (fixtures `example.invalid`); no new platform flag; `email_queue` attribution and the sender registry from Track F Increment 2 are designed but not built.

**Pre-assigned numbers (Rule 16):** migration `0059` (0058 is reserved for Track F Increment 2, mail); `DECISION-183`–`DECISION-189`; findings `F153`–`F159`. Worktree `presby-invites`, branch `pipeline/invitations`, Neon branch `pipeline-invitations` (`br-mute-credit-axdunoa2`).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-21 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-21 |
| 2 — Architectural review (addendum on Phase 3 divergences) | architect | Complete | Approved with suggestions | 2026-10-21 |
| 2 — Architectural review (addendum 2: hand-off cookie path) | architect | Complete | Approved with suggestions | 2026-10-21 |
| 3 — Technical design | tech-lead | Complete | Design complete (Increment 1); implementers named | 2026-10-21 |
| 4 — Implementation | api-developer (B0) → database-admin (B1) → api-developer (B2) → ux-developer (B3) → **full-stack-developer (B4, one coupled batch; Phase 3 had split it between api-developer and ux-developer)** | **Complete.** Batch 0 committed 3c294fc/a423b40/6c73c08; Batch 1 committed 1199659; Batch 2 committed fda586c; Batch 3 committed aea024a; **Batch 4 complete (uncommitted): addendum-2 cookie fix with fail-before/pass-after observer e2e, the throwaway-org invitation e2e fixture, new-account + existing-account (Case A, Case B, treasurer, mismatch) + fixture-sweep specs, admin-organizations Tests 7-8 rewrite, a post-accept session refresh (F167); 7081 unit tests, 72 e2e green incl. the three auth specs** | — | 2026-10-21 |
| 5 — Verification | qa | Complete | PASS | 2026-10-21 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-10-21 |

---

# Phase 1 — Functional Refinement (analyst)

*2026-10-21, analyst (read-only; recorded verbatim by the orchestrator). `../fpcw-directory` and `../psvonline-portal` were read from `/Users/cshenso/git` (siblings of `presby/`).*

## VERDICT

**READY WITH NOTES.** The feature is buildable and the pieces fit. The kickoff shape needs six corrections (C1–C6) and has nine open questions, each with a recommended default, so none blocks Phase 2. Q1, Q2 and Q6 change shipped behaviour or an agreed rule — confirm them before Phase 3.

## ONE-LINE TAKE

> Someone who already holds the authority to name a person sends a single-use link to an email address. The recipient, not the sender, proves they control that mailbox. They set a password, or sign in to an account they already have, and only then are they linked to the church record and given the designated access. The sender's screen never says whether that address already has an account.

## Corrections to the kickoff shape

- **C1. Designation becomes consent-based for every email, not only unknown ones.** A designation is recorded as pending and takes effect only when the email owner accepts. Today an existing account is designated instantly. That is the only way to make the sender's UI identical for both cases (no enumeration). It also closes a live hazard: a mistyped email that happens to belong to a real account silently receives administrator authority today (`founding-administrator.ts:508-519`). Behaviour change for existing accounts.
- **C2. There is no "grant to an email" at org level.** Role grants, officer terms, group seats and staff hires all name a person picked from the roster; the email lives on the person (`contact_methods`). Those actions already succeed and produce authority nobody can use, with no hint in the UI. The org-level feature is person-centred: an "Invite to sign in" action plus a visible "No login yet" marker. An org-level invitation carries no authority; it only links a login to that person. Authority is whatever `role_grants` or group seats exist at acceptance time. Do not auto-send on hire or grant; offer it as an explicit step.
- **C3. Platform designation invitations do carry intent.** Pending until accepted; nobody holds the role meanwhile.
- **C4. Google is a defined rule, not a wired path, in this pipeline.** Google isn't configured, so it can't be exercised or e2e-tested; don't ship an untestable authority-granting path. Ship one shared claim function with a written contract; wire Google when configured (Q8).
- **C5. The current "sign up first" copy is false.** Two refusals tell the operator to have the person sign up first (`organizations/[id]/actions.ts:727` and `:843`); `(auth)` has only `/signin` and `/totp`, and Google is unconfigured, so there is no sign-up path (the operator hit this 2026-10-21). Both strings and the "must sign up first" hint in `founding-administrator-section.tsx` (~191) are removed.
- **C6. Treasurer designation flips to resolving the person first.** Today it resolves the user by email, then that user's person (`treasurer-designation.ts:264-299`). A person with no account has no user, so the lookup starts from a person already existing at the org, found by the email on file.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Platform admin (`/admin/organizations/[id]`) | Invite a founding administrator (email, first and last name, confirm dialog) | One-time per org, or lockout recovery |
| Platform admin | Invite a first treasurer (email of a person already enrolled at that congregation) | One-time per org, or lockout recovery |
| Platform admin | Resend, revoke, or replace (revoke then invite) a pending invitation | On demand |
| Platform admin | Revoke all open invitations from an org (abuse takedown) | Rare |
| Org admin (`people.manage`) | Invite a person to sign in, from the staff roster or person row | Per hire or enrolment |
| Org admin | Resend or cancel that invitation | On demand |
| Anonymous invitee, no account | Open the link, read who invited them and to what, confirm their name, set a password, submit | One-time |
| Anonymous invitee with an account | Open the link, sign in, confirm, accept | One-time |
| Newly signed-in invitee | Sign in through the standard form, enrol 2FA if required, land via `/launch` | One-time |
| System | Expire after 7 days (derived, not a job); queue and send the email | Continuous |

## Flows

**Flow 1 — Platform operator invites a founding administrator.** Entry: `/admin/organizations/[id]`, the existing section; email, first name, last name. The confirm dialog names the org, the address and what the role grants. Result: "Invitation sent to x. It expires on [date]. Nobody holds this role until it is accepted." The section shows a pending row (address, sent, expiry, delivery state queued/sent/bounced, Resend, Revoke). The send step does not look up `users` at all — the enumeration defence (same work and response whether or not the address has an account). Named failures describe the org, not the email: the org already has a holder (the lockout-recovery sentence stays); an invitation is already pending ("Resend or revoke it"); the org type does not apply; baseline setup incomplete; invalid email. Rate limit: generic "try again later". Email delayed: "Invitation created. Email delivery is delayed; we'll keep trying." DB error: the existing "We couldn't complete that just now".

**Flow 2 — Treasurer.** Same shape. The address must match exactly one live person with an active membership at this congregation. Named outcomes describe the roster, not account existence: no match — "Nobody enrolled at this congregation has that email on file. The congregation's administrator enrols them first."; more than one match — refuse as ambiguous. The zero-`giving.manage`-holder gate runs at send and again at acceptance.

**Flow 3 — Invitee with no account.** Entry: `/invite?token=…` (an exact path in `PUBLIC_PATHS`; token in the query, no prefix bypass).
1. GET renders a preview and consumes nothing (mail scanners and link prefetchers open links; the existing `verify-email` page consumes on GET — do not copy it). Shows the church, the role in plain words, a masked address; an editable name field; password and confirmation, rules stated before typing.
2. POST accepts in one transaction: create the account, link or create the person, apply the designation, mark the address verified, consume the token, write the audit rows. Any failure leaves nothing behind.
3. Success: "Your account is ready" → the standard `/signin?callbackUrl=/launch`. No auto sign-in in v1 (Q7) — it would route around Turnstile, rate limit and lockout in `src/auth.ts`.
4. Sign-in → 2FA if required → `/launch` (founding administrator → `/o/<slug>`; a treasurer holding a giving key is forced by `presby_two_factor_required()` arm B through `/totp` → `/account/2fa` enrolment → back). The destination is built server-side from the stored org slug.
- Dead link: one message for no such token / expired / revoked / used / superseded by a resend — "This link is no longer active. Ask whoever invited you to send a new one." (DECISION-147 single bucket, round-trip parity.)
- Conflict at accept (org gained a holder, membership ended, person merged away, account already linked elsewhere): nothing created; a plain explanation naming who to contact.
- `auth.local_login` off: no password offered; says password sign-in is off and points to the other route (G8).
- DB blip: "We can't finish setting up your account right now. Your link is still good." Token not consumed.
- Double submit: button disables while pending; server idempotent for the same outcome.

**Flow 4 — Invitee who already has an account.** Same preview; primary button "Sign in to accept" → `/signin?callbackUrl=<this URL>` (the sanitizer already allows a rooted path with a query). Back on `/invite` signed in: the session email must equal the invited email, else "You're signed in as another account. Sign out to accept this invitation." (address masked); if the account requires 2FA, the session must be 2FA-verified (G9); if the account is linked to a person at another org, the existing `person_elsewhere` rule applies (invitee sees the plain explanation; the platform operator sees the blocked reason later; an org admin sees only "couldn't be completed").

**Flow 5 — Resend, revoke, replace, expiry.** Resend mints a new token and kills the old (5-minute cooldown). Revoke is terminal. "Change designee" is revoke then new (pending blocks a second). Expiry derived at read time; the row shows "Expired. Resend". One status vocabulary for org admin and platform: pending, accepted, expired, revoked, couldn't be completed.

**Flow 6 — Org admin invites a person to sign in (Increment 2).** Staff roster row or person page: "No login yet. Invite to sign in". The address is the person's on-file email, or the admin adds one first; the admin sees the full address before sending. Refused if the person already has a login; refused if the person already holds access beyond the inviter's (Q5). Cancel/resend as Flow 5.

**Flow 7 — Two orgs invite the same email.** Independent invitations, one open per (org, purpose, address); neither org sees the other's. The first acceptance creates the account; the second takes Flow 4. Under the current one-person-per-org identity rule (`person_elsewhere`) the second acceptance is blocked — existing policy, now surfaced to the invitee in plain words.

**Flow 8 — Google (deferred wiring).** The claim function takes `(userId, verified email)` and applies any open invitation for that address, idempotently, at first sign-in. Prerequisites in G11.

## Permissions & Flags

- **Sending, platform:** existing `FEATURES.ADMIN_ORGANIZATIONS`, checked in the action body (`auth()` then `hasFeature`), as the two designation actions do; listing, resending, revoking use the same key. No new `FEATURES` key.
- **Sending, org:** existing tenant `people.manage` (already in the founding-administrator bundle). Recommend against a new `members.invite` key — every new tenant key must also join `foundingAdministratorPlan()` and be backfilled (F150/0057), not justified here.
- **Acceptance:** the token — a third access mechanism beside permissions and flags (DECISION-147), never mapped into `FEATURES.*`, a session claim or the resolver; it names its own org and purpose; no client-supplied org id trusted.
- **Flags:** none new. Existing flags interact (G8): `auth.local_login` (fail-open helper), `auth.require_2fa` (backstop; arm B already forces 2FA for giving keys).
- **Rollback without a flag:** deploy revert; open tokens land on the dead-link page; pending rows are inert; the platform "revoke all open invitations for an org" doubles as the kill lever.
- **Default roles:** platform admins holding `admin.organizations`; tenant `founding_administrator` and any role carrying `people.manage`.

## Gaps the Request Didn't Address

- **G1. "Pending" and the zero-holder gate.** A pending designation blocks a second for that org and purpose ("An invitation is already pending. Resend or revoke it."). Checked at send and again at acceptance; if a holder appeared meanwhile, acceptance fails closed with nothing created and a message to the invitee. The designation audit event fires at acceptance, not send.
- **G2. Founding-administrator name.** `deriveNameFromUser` falls back to the email local-part (`jsmith jsmith`) with no user name. Resolution: the sender supplies first and last name; the invitee confirms; the email greets by name.
- **G3. Link vs create the person, duplicate-person risk.** Platform path: auto-link only on an exact normalized email match to exactly one live person at the same org; zero → create a person with a staff-kind membership; more than one → refuse; no fuzzy matching (`matchPerson()` is tenant-connection/`people.manage` and doesn't fit). Org path: the inviter chooses the person — no matching. Fail closed if the person was merged away (`merged_into_id`), their membership ended, or the person has a different `user_id`; set `user_id` only `where user_id is null`; refuse if the account is already linked to a live person at this org. Shared household addresses are common: the acceptance page names the person ("Accepting as Marie Doe at Pasture Church") and asks for confirmation. Acceptance may set `contact_methods.verified_at`; must not write `person_identifiers` (nothing populates it; its verified-and-unshared unique index would make a shared address fail).
- **G4. Token design.** 32 random bytes base64url, stored only as SHA-256; unique index; one open row per (org, purpose, normalized email). Bound to the normalized email; an existing-account acceptance requires session email = it (Gmail dot/plus variants fail closed with a clear message). Expiry 7 days default, 30 max (Q3). Atomic claim in the same transaction as every effect. Resend rotates the token (old queued email dead on arrival). Never consumed on GET; never in audit metadata or logs; the page sends `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `noindex`.
- **G5. The credential sits at rest in `email_queue`.** `enqueueEmail` stores the rendered HTML and text, link included, indefinitely, on a table with `presby_app` DML and no RLS (`queue.ts:239`) — DECISION-173 refused statement contents there for that reason. A stored admin-granting link makes "hashed at rest" false in effect. Resolution (Q6): after status becomes `sent`, replace the link in the stored body for the invitation template key; TODO for `password_reset`, `email_change_verify`, `statistics_grant`. Conflicts with "read the link from the queue row" as a test seam (see G16).
- **G6. Mail class and link origin.** Track F R11 lists "future invitations" under class `org`, but DECISION-182 puts credential-bearing org mail on the fallback sender only, and account mail stays on the platform domain — an invitation link is an account-creating credential, so those cannot all hold (Q2). Whatever the class, the link is built from `NEXT_PUBLIC_APP_URL`, never the request Host or a church host (custom hosts have no session or platform routes; a link to one would 404 and be phishable). Register a distinct template key `account_invitation` so the future registry classifies it deliberately.
- **G7. Abuse limits are weaker than they look.** The in-memory limiter resets per Vercel instance (`rate-limit.ts`); Upstash and Turnstile are still operator to-dos. Build durable limits from the invitation table: per inviter, per org, per recipient address across all orgs (e.g. 3 per 24 h), resend cooldown and cap. Keep `checkRateLimit` as a second IP-keyed layer on `/invite` POST (like `stats_submit`). Over-limit copy identical for every cause; doesn't reveal other orgs' invitations. Only vetted tenants exist, limiting spam to a compromised org admin.
- **G8. Configuration states that strand an invitee.** `auth.local_login` off — the accept page offers no password; warn at send time. `AUTH_TOTP_ENCRYPTION_KEY` unset — `/account/2fa` says "Not available right now", so a treasurer would be stuck at the 2FA wall; check `isTotpConfigured()` at send for 2FA-forcing purposes and refuse with an operator-facing message.
- **G9.** An existing 2FA-enrolled account must not accept authority from a password-only session: require `twoFactorVerified` when `twoFactorRequired` (as `/admin` and `/o/*` do).
- **G10.** Post-accept sign-in is manual through the standard form in v1 (Q7).
- **G11. Google claim contract.** `allowDangerousEmailAccountLinking: true` is safe only because Google verifies email; `evaluateSignIn` never checks `email_verified` — a claim that grants authority must require `email_verified === true`. The `signIn` callback fires before the adapter creates the user (placeholder `user.id`; fpcw documented this), and `events.createUser` is fire-and-forget (the `jwt` callback already works around it for `ensureDefaultRole`, `auth.ts:251`), so the claim runs synchronously in the first-sign-in branch of `jwt`. fpcw's `completeMemberLinkingForUser` is prior art (one idempotent function from both entry points), but fpcw auto-links by email with no invitation — presby must not.
- **G12. Visibility.** Sender lists show status + delivery state; link the invitation to its `email_queue` row (as 0056 did for statements) so a bounce shows "Bounced. Check the address". Platform admins see invitations platform admins sent; for org-sent ones, counts, org, time, masked addresses and revoke-all (Q9).
- **G13. Silent inert grants today.** A "No login yet" marker beside staff, officers and grantees; say "has a login" only about the org's own persons, never about an address.
- **G14. Audit events** (ids only): `invitation.created` (send), `invitation.resent`, `invitation.revoked`, `invitation.accepted` (metadata `mode: new_account | existing_account`, `invitationId`, `organizationId`, `purpose`, `personId`; actor email = the new user's own), `invitation.accept_blocked` (reason code), `user.created_via_invitation`, and `org.founding_administrator.designated` / `org.treasurer.designated` at acceptance with `viaInvitationId` (keeping the tenant `organizationId` stamp, F18).
- **G15. Acceptance pages** (platform palette, no `BrandTokens`, `check:brand-scope` stays green): inline `role="alert"` errors (the reset page's toast-only errors aren't announced); labels tied to inputs; `autocomplete="new-password"`; show-password toggle; rules stated first; 16px inputs; 44px targets; focus to heading or error on state change; one column at 360px; no colour-only status; no `useForm`, or `HydrationGate` if used (DECISION-159).
- **G16. Test strategy without inboxes.** Fixtures `example.invalid`; `check:secrets` clean. Send half: assert the `email_queue` row (recipient, template key, link from the app origin, absent from audit and logs). Accept half: e2e on a running server seeding an invitation with a known token hash (as `statistics-fixture.ts`, `e2e/support/totp-fixture.ts`). Two e2e paths required by the MFA gate: a new invitee through accept → sign-in → `/totp` enrolment → landing; an MFA-enrolled existing user accepting. Don't copy `forgot-password.spec.ts` (stops before consuming the token). Because of the scrub, no test depends on the stored body. One real-provider smoke via Resend test inboxes before go-live. The 2026-10-21 hand-created stopgap account is the natural day-one acceptance case.
- **G17. Input boundaries (server-side).** Password 8 min, 72 bytes max (bcrypt truncates; the reset path has no max) — count UTF-8 bytes. Name 1–100 chars, trimmed, NFC, control chars stripped. Email ≤ 320, trimmed, lowercased. Sender-supplied strings (org and person names) `escapeHtml`'d and capped. No free-text sender message in v1 (a phishing channel in platform-domain mail).
- **G18. Retention.** Terminal rows keep the address; propose nulling to a hash 90 days after the invitation ends (Q9), stated in the migration comment.
- **G19. `do_not_contact`.** Transactional, not marketing: send anyway, warn the inviter before confirming.

## Adversarial pass

- **Redirect targets:** only the post-accept `/signin?callbackUrl=` and the `/launch?next=` hand-off; `callbackUrl` goes through `sanitizeCallbackUrl()`; `/o/<slug>` built from the stored slug. Gap: the token rides inside `callbackUrl` during sign-in — keep it out of logs and audit.
- **State-machine shortcuts:** `/totp` or `/launch` before accepting does nothing (authority exists only after the acceptance transaction); POSTing accept without the GET preview runs the same checks; a POST naming another invitation's id fails (org and purpose come from the token's row).
- **Enumeration:** send never reads `users`; the dead-link page is one bucket with round-trip parity; rate-limit copy identical; invited address masked on the mismatch page; the "already linked elsewhere" reason shown to the platform operator only, after the fact. Existing leak, not fixed here: `requestEmailChange` says "That email is already in use" to any signed-in user (`account/actions.ts`) → TODO.
- **Input boundaries:** G17; empty/whitespace name and password rejected server-side; overlong bodies capped by the server-action limit.
- **Self-targeting:** an org admin inviting their own person is refused (already has a login); a platform admin may designate themselves founding administrator (allowed, `inviterIsInvitee` stamped in audit); revoking one's own sent invitation is allowed.
- **Forwarded or leaked link:** a bearer credential (as password reset); mitigated by 7-day expiry, single use, named-person confirmation, email binding for existing accounts. Accepted residual: a forwardee with no account sets a password and becomes that person; the church admin sees "Accepted [date]" and can undo via role tools.
- **Wrong or squatted address (the central risk):** whoever controls the mailbox becomes the person and inherits existing grants. Mitigations: the admin sees the full address before sending; the acceptance page names the person and asks for confirmation; the org-level subset rule (Q5); treasurer and founding-administrator flows are platform-originated with a confirm dialog.
- **Pre-hijack:** no self-signup, so an attacker can't pre-create a credentials account for the victim; email change requires control of the new mailbox; Google per G11.
- **Mail abuse:** platform-domain mail with attacker-controlled names is a phishing/spam vector; G7 limits volume; G17 forbids free text and escapes names.
- **Cross-tenant:** an org admin resolves their org from the URL slug through the membership check, never client data; reads and cancels only their own org's rows.
- **Concurrency and replay:** atomic claim in one transaction — one winner; replay → dead-link page; DB failure rolls the claim back.
- **Account lockout:** failed sign-ins lock for 15 minutes; doesn't affect new-account acceptance, but an attacker could lock a known existing invitee at sign-in — existing behaviour, noted.

## Out of Scope (confirm with user)

Bulk/CSV invitations; SMS/phone; a free-text inviter message; auto-send on hire or grant; self-service "request access"; domain auto-join; a "My invitations" card on `/home`; a cross-org invitation list; church-domain mail and the sender registry (Track F Increment 2); auto sign-in after accept; wiring Google (C4); writing `person_identifiers`; breached-password checks or magic-link login; changing the account email during acceptance; statistics-grant links (separate token system); a purge job for terminal rows.

## Open Questions (recommended default in bold)

1. **Q1 (needs confirmation).** Pending-until-accepted for existing accounts too (C1)? **Yes** — an existing account holder must click once.
2. **Q2 (needs confirmation).** Mail class: **all invitations in v1 from the platform domain** under `account_invitation`; with the registry, platform-originated = `account`, church-originated at most `org_fallback_only`, never the church's own domain — departs from the R11 row "future invitations: org" (ambiguous there).
3. **Q3.** Expiry **7 days, 30 max, resend resets.**
4. **Q4.** Pending blocks a second **— yes (G1); change designee = revoke then new.**
5. **Q5.** Org-level subset rule (refuse to invite a person whose access exceeds the inviter's) **— yes**, mirroring DECISION-106; tech-lead to confirm the resolver call is feasible in the org context.
6. **Q6 (needs confirmation).** Scrub the link from `email_queue` after send **— yes for the invitation template; TODO for the other credential templates (G5).**
7. **Q7.** Auto sign-in after accept **— no in v1.**
8. **Q8.** Google claim **— ship the function and contract now; wire and test when Google is configured** (TODO with the G11 prerequisites).
9. **Q9.** Platform visibility into org-sent invitations **— counts, masked addresses, revoke-all only; null the address 90 days after the invitation ends (G18).**
10. **Q10.** Delivery state and bounces in sender lists **— yes**, via the queue-row link.

## Recommended batch order

- **Increment 1 — platform designations plus the acceptance machinery** (closes the operator's blocker; the first customer needs it):
  - **A. Schema (database-admin).** Migration `0059`: the invitation table (token hash unique, purpose, org, normalized email, optional person, expiry/accepted/revoked/superseded timestamps, queue-row link); one open row per (org, purpose, email); composite tenant keys; FORCE RLS; no delete; a `SECURITY DEFINER` claim function in the DECISION-147 shape; a `scripts/test-rls.sql` section.
  - **B. Library and actions (api-developer).** Create, resend, revoke, preview, accept, with durable limits (G7), audit (G14), the template and the scrub (G5); refactor the two `designate*` transactions into "apply designation for user X" callable at acceptance with no change to their resolver-file invariants; remove `no_such_user`.
  - **C. UI (ux-developer).** Public `/invite` (exact `PUBLIC_PATHS` entry); pending/resend/revoke panels in both designation sections; new copy.
  - **D. Verification.** Seeded-token e2e on a real server, both MFA paths (G16); functionality map; TODO reconciliation; Rule 13 decision (internal tooling — likely no).
- **Increment 2 — org-level "Invite to sign in"** (`people.manage`, subset rule, "No login yet" markers, resend/cancel).
- **Increment 3 — Google claim**, when Google is configured.

All auth-touching: the Phase 4/5 MFA e2e gate applies to every increment changing `src/lib/auth/`, `(auth)` or `src/auth.ts`.

## Handoff

**Next: architect (Phase 2).** Rule on: (1) where the anonymous write to tenant tables lives (recommend a definer function deriving org and purpose from the token's row, no org GUC; the `0054` unique index on `people.user_id` is still withheld, F110/F112, so the "link only where null" and "no live person at this org" checks carry the weight); (2) directory placement (the founding-administrator work-log said a second onboarding module is the moment to create `src/lib/onboarding/` and move both modules in one commit); (3) route group and proxy treatment for `/invite` (exact path, platform palette, `check:brand-scope`); (4) the credential-body scrub (G5) and template key (G6); (5) whether "Two Hierarchies" and "Composite Tenant Keys" need CLAUDE.md wording for the new table.

**Per-Phase Status:** | 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-21 |

---

## Operator rulings on the Phase 1 open questions (2026-10-21)

- **Q1 — pending-until-accepted for existing accounts too (C1):** **yes, always pending.** Every designation is an invitation and takes effect when the email owner accepts.
- **Q2 — mail domain:** **always `presbyportal.org`.** Invitation links create accounts, so they are account mail and stay on the platform domain, even after church mail domains ship (amends the Track F R11 table row "future invitations: org"; DECISION-182's registry classifies `account_invitation` as `account`).
- **Q6 — scrub the link from `email_queue` after send:** **yes** for the invitation template; TODO for `password_reset`, `email_change_verify`, `statistics_grant`.
- **Q3–Q5, Q7–Q10:** the analyst's recommended defaults stand (7 days / 30 max / resend resets; pending blocks a second, change = revoke then new; org-level subset rule; no auto sign-in in v1; Google claim function + contract now, wired later; platform sees counts/masked/revoke-all for org-sent, address nulled 90 days after end; delivery state shown via the queue-row link).

---

# Phase 2 — Architectural Review (architect)

*2026-10-21, architect (read-only; recorded verbatim by the orchestrator). Live catalog checked on `ep-autumn-mud-axr8kawo` (`pipeline-invitations`; 0057 applied): `pg_trigger`, `aclexplode(relacl)`, column ACLs, `relforcerowsecurity`, definer owners and `proconfig` queried directly.*

## Verdict

**Approved with suggestions.** No new dependency, connection or flag. Six rulings amend Phase 1; recorded as resolutions and advancing. R3 (the Google path), R9 (no self-designation) and R6 (sign-in hand-off) change what the operator was shown and need the operator to see them. **If Q1 comes back "no"**, R1 reopens. *(Orchestrator: Q1 answered "yes, always pending" on 2026-10-21 — R1 stands.)*

## Placement

- **Library: new top-level module `src/lib/onboarding/`.** First commit is a pure `refactor:` move of `src/lib/founding-administrator.ts` and `src/lib/treasurer-designation.ts` (+ tests) into it, updating every importer found by grep in the same commit (the `(admin)/admin/organizations/[id]` actions, page, sections and tests; `e2e/admin-organizations.spec.ts`; path comments in `src/lib/giving/team.ts` and `scripts/test-rls.sql`). Then add: `invitation-token.ts` (pure `node:crypto`; 32 random bytes base64url + sha256 hex; also the e2e fixture seam); `issue.ts` (server-only, **platform connection only**: create, resend, revoke, revoke-all-for-org, list-for-org, durable limits; `(admin)` callers only); `accept.ts` (server-only, **`db`/presby_app only**: preview and accept through the R1 definer functions); `invitation-email.ts` (renders the email, link from `platformOrigin()`, the `account_invitation` key). The in-transaction audit helper is imported from `src/lib/domains/audit-tx.ts` or lifted to `src/lib/audit-tx.ts` (S3).
- **Schema:** `src/lib/db/domain/invitations.ts` (index export at integration, Rule 16); DDL in hand-written `drizzle/0059_presby_account_invitations.sql`.
- **Route group: new un-brandable `(invite)`** — `src/app/(invite)/invite/page.tsx` (preview and every state), `src/app/(invite)/invite/accepted/page.tsx` (static confirmation accepting no token, like `/file-statistics/submitted`), `src/app/(invite)/actions.ts`. **No `layout.tsx`, no `loading.tsx`** (the page redirects; a Suspense boundary would flush a 200 first). Not `(auth)` (it redirects signed-in users away; Flow 4 needs a signed-in user here).
- **Proxy:** `PUBLIC_PATHS` gains exactly `"/invite"` and `"/invite/accepted"`, no prefix match — a Set-literal edit; `check:proxy-imports` untouched. **Confirmed unreachable on church hosts:** the custom-host first branch (`src/proxy.ts:64-81`) returns a 404, a 204 probe, a cron pass-through or a rewrite to `/site/<host>/invite`, never reaching `PUBLIC_PATHS`; a church site's own `invite` page is the church's page.
- **Server/client split:** `page.tsx` is a Server Component — reads the token (query or the R6 hand-off cookie) and `auth()`, calls `accept.ts` preview, renders one of: dead link, create account, sign in to accept, signed in as someone else, 2FA required, confirm. `'use client'` only for the accept form (pending state, show-password toggle, focus management, inline `role="alert"` errors) — a plain `<form action>` with `useActionState`, not react-hook-form, so it degrades before hydration (if Phase 3 chooses `useForm`, `HydrationGate` is mandatory, DECISION-159). "Sign in to accept" is a plain server-action form, no client JS. The `(admin)` sections (already client) gain pending rows, Resend, and Revoke behind an `AlertDialog`, with data read in `page.tsx` through `issue.ts`.
- **Dependencies: none** (`node:crypto`, `bcryptjs`, Resend, Postgres 18's built-in `sha256()` verified on the branch; no pgcrypto).

## Invariants Touched

- **Isolation Is a Database Property:** the anonymous write path never holds the owner connection (R1, R2); `account_invitations` FORCE RLS with `tenant_isolation`; in 0059 presby_app holds **no table privilege**, only EXECUTE on two definer functions (DECISION-171 inbox posture); no org GUC on the acceptance path.
- **Two Hierarchies Intersect Nowhere:** every `role_grants` row names the invitee; `granted_by` = `account_invitations.created_by_user_id` is provenance only (no resolver arm or authority check reads it); `origin` drives visibility only; the four resolver files (`src/lib/authz.ts`, `src/lib/role-definitions.ts`, `src/lib/role-grants.ts`, `drizzle/0010`) and `presby_two_factor_required()` unchanged and pinned. **Correction to Phase 1:** a platform admin accepting their own designation is acquiring tenant authority by platform position — the invariant's testable form — refused (R9). No CLAUDE.md wording change here.
- **Composite Tenant Keys:** `unique (id, organization_id)`; `(person_id, organization_id)` references `memberships (person_id, organization_id)` (relationship-row idiom; `people` is global, D1); composite supersession self-FK; plain FKs to `users` only (as `role_grants.granted_by`); `email_queue_id` a plain uuid with no FK (0056 precedent). No CLAUDE.md change.
- **Permissions vs Flags:** sending, listing, resend, revoke use existing `FEATURES.ADMIN_ORGANIZATIONS` (`auth()` then `hasFeature` in each action body); no new `FEATURES` key, tenant permission or flag; the token is the third mechanism (DECISION-147), never mapped into `FEATURES.*`, a claim or the resolver. **CLAUDE.md change requested** (Key Invariants says "Two mechanisms"): *"A credential (hashed, single-use, expiring; DECISION-147, DECISION-183) is a third mechanism: it authorizes only the act its own row names, inside SECURITY DEFINER functions that derive org and purpose from that row, and is never mapped into `FEATURES.*`, a session claim or the resolver."*
- **Auth-critical flag helpers:** `auth.local_login` read only via `isLocalLoginEnabled()` (fails open), for the send-time warning and whether the accept page offers a password; `auth.require_2fa` not read — G9 uses the session's `twoFactorRequired`/`twoFactorVerified` from `computeEffectiveTwoFactor()`; `src/auth.ts` and `src/lib/auth/` **unchanged in Increment 1** (R3).
- **The Brand Is a Cascade Override:** `(invite)` un-brandable by default (`check-brand-scope.mjs` E1/E2 allow-list only the three emitters; green with no edit). **CLAUDE.md change requested:** add `(invite)` to the un-brandable list; architect file route-group bullet (Handoff).
- **(org) contract:** untouched in Increment 1; Increment 2 under `withOrgContext()`.
- **Never hard-delete / permanence:** no DELETE grant on any role; a cascade-aware `BEFORE DELETE` guard binds the owner, passing only fixture-org teardown (0057 `presby_org_domains_guard_delete()` idiom).
- **Edge gate / proxy:** the proxy change is a Set entry; `src/proxy.ts` counts as auth-touching (DECISION-177).
- **Auth-touching gate:** `(invite)` creates accounts and drives sign-in — auth-touching for the Phase 4/5 MFA e2e gate.

## Binding rulings

**R1. Acceptance is one SECURITY DEFINER function on presby_app; the designation moves into SQL.** `presby_accept_invitation(p_token text, p_user_id uuid, p_password_hash text, p_first_name text, p_last_name text)` — exactly one of `p_user_id` (existing account) / `p_password_hash` (new account) non-null; derives org, purpose, email and person from the token's row; no GUC; applies account, person link, designation and claim in the caller's transaction; owned by `neondb_owner`, `search_path = public, pg_temp` (DECISION-148), EXECUTE to presby_app only, revoked from `public` and `presby_platform`.
- Rejected: acceptance on `getPlatformDb()` (puts the bypass-RLS owner connection on an internet-reachable route; DECISION-171 refused exactly that; Increment 2 would need a second path); a definer claim plus TypeScript owner-connection writes (two connections can't share a transaction); a definer that sets the org GUC then runs ordinary DML (the "system org context" bypass DECISION-171 refused).
- Consequence under C1: `designateFoundingAdministrator()` and `designateTreasurer()` lose their only caller; their effect is **ported to internal, ungranted plpgsql helpers** (`presby_apply_founding_administrator`, `presby_apply_treasurer`) with the same steps (lock the org row and read its type fresh; holder gate; F109 reuse-and-reactivate; additive-only permission reconcile; office template from the live row; person-arm grants); then the TypeScript transactions are deleted. **Phase 4 lands a parity DB test before the deletion** (same `app_roles`, `app_role_permissions`, `role_grants`, `people`, `memberships` rows over shared fixtures).
- Single sources: the gates become `presby_founding_administrator_holder_count(org)` and `presby_giving_manage_holder_count(org)` (owner-only, revoked from presby_app — a cross-org count is an oracle; the definer uses them at accept, `issue.ts` at send via `getPlatformDb()`; TypeScript `count*` exports become thin wrappers). The founding-administrator bundle becomes `presby_founding_administrator_permission_keys(org_type)`; `foundingAdministratorPlan()` stays as display copy, **pinned equal by a DB test** (DECISION-180 idiom). F111/F118/F150 unchanged; a future key now edits SQL, TypeScript and the backfill.
- New account: the function inserts the `users` row (`email` = the invitation's address, never client input; `email_verified = now()`); bcrypt computed in TypeScript after the G17 72-byte check, the function checks its shape; a `users.email` unique violation returns `account_exists` ("sign in to accept"); never overwrite a password; `ensureDefaultRole()` binds the member role at first sign-in.
- Existing account: the function checks `users.email = invitation email` and `is_active` (a presby_app bug can accept only for the invited account); trusting presby_app for "this is the session user" is accepted (DECISION-171 wording).
- Refusals: uniform for identity, honest for state (DECISION-152 split). Unknown / expired / revoked / superseded / consumed / blocked → **one literal**, one round-trip shape (DECISION-147 bucket). After the credential is proven, honest codes: `has_holders`, `person_elsewhere`, `membership_ended`, `person_merged`, `person_linked_elsewhere`, `ambiguous_person`, `account_exists`, `not_applicable`, `provisioning_incomplete`. A gate conflict commits a terminal `blocked_at`/`blocked_reason` with **nothing else written**, plus `invitation.accept_blocked`.
- Person linking under the withheld `people.user_id` index (G3, F110/F112): `user_id` set only `where user_id is null`, row count 1; never follow `merged_into_id`; refuse when the user already has a live person elsewhere (`memberships_guard_insert`, live SECURITY DEFINER, stays the backstop); **lock the `users` row `for update` before any person read** (serializes acceptances for one account, standing in for the missing index); set `contact_methods.verified_at` where the on-file address matches; never write `person_identifiers`.
- Lock order for every writer (issue and accept): organization row → invitation row → users row → person. Accept reads the invitation by hash unlocked, locks the org, re-selects the invitation `for update` and re-validates (no resend/accept deadlock).
- Live trigger check (owner path): `memberships_guard_insert` (definer), `memberships_sync_derived_group` (invoker), `memberships_guard_end`, `role_grants_needs_membership` (invoker), `app_role_permissions_giving_guard` (definer), `people_guard_delete` behave as DECISION-155 measured (`current_user` = owner bypasses RLS); `app_roles` and `contact_methods` carry no triggers.
- Atomic audit: rows inserted in the same transaction by `accept.ts` after the function returns (never `recordAudit()`).

**R2. Migration 0059 shape.** Table `account_invitations`: `id`; `organization_id` (FK `organizations`, `on delete cascade`, reachable only via D10's guarded fixture teardown); `purpose` CHECK in (`founding_administrator`,`treasurer`) (Increment 2 widens); `origin` CHECK in (`platform`) (Increment 2 adds `org`); `email_normalized` CHECK lower, trimmed, ≤ 320; `invitee_first_name`/`invitee_last_name` required for `founding_administrator`; `person_id` required at insert for `treasurer`, null → value once at accept for `founding_administrator`; `token_hash` unique `^[0-9a-f]{64}$`; `created_by_user_id`, `created_at`; `expires_at` CHECK `> created_at` and `<= created_at + 30 days`; `email_queue_id` plain uuid set once; `accepted_at`, `accepted_user_id`, `revoked_at`, `revoked_by_user_id`, `superseded_at`, `superseded_by_id` (composite self-FK), `blocked_at`, `blocked_reason` (closed list); `redacted_at`. CHECKs: at most one terminal timestamp; `accepted_at` ⇒ `accepted_user_id` and `person_id`; email null iff `redacted_at`, and `redacted_at` ⇒ terminal. Indexes: partial unique `(organization_id, purpose, email_normalized)` where all four terminal timestamps null (expiry derived, outside the predicate — an expired row blocks until a resend supersedes it, Flow 5; per F103 not an oracle: `organization_id` leads, presby_app can't insert in Increment 1); `(email_normalized, created_at)`, `(created_by_user_id, created_at)`, `(organization_id, created_at)` for the limits. Freeze trigger (`BEFORE UPDATE`, every connection): identity columns and `token_hash` immutable (never rotated); terminal states one-way; **the accept transition requires the transaction-local marker `presby.invitation_accept_active`, armed only inside `presby_accept_invitation`** (grant plus marker, DECISION-141); revoke, supersede, redaction are owner-path transitions. Resend: a new row; the old superseded in the same transaction. Grants: `revoke all` from presby_app and presby_platform; `presby_platform` `select` (0049 idiom); presby_app EXECUTE on `presby_preview_invitation(text)` and `presby_accept_invitation(...)` only. Preview: `STABLE SECURITY DEFINER`, zero rows for every non-live state, else org name and type, purpose, invitee names, the person's display name, `expires_at`, and the **address masked in SQL** (the full address never reaches app code on the anonymous path; DECISION-153). Cascade-aware `BEFORE DELETE` guard (0057 idiom). Comments state the 90-day redaction policy **as not yet enforced** (S6) — the release note must not claim it. `scripts/test-rls.sql` section at integration showing: presby_app can't read/write/delete rows; a marker-less accept transition refused on the owner path; dead-link refusals one literal; the gate functions not executable by presby_app. `check:schema-parity` covers the new domain file.

**R3. Google: no claim in `signIn` or `jwt`; the token is the only acceptance credential.** (Amends Phase 1 C4/Flow 8/G11/Q8.) Auto-applying open invitations at first Google sign-in contradicts C1 (signing in is not consent) and skips G3's "Accepting as Marie Doe" confirmation. Google is simply another way to be signed in for Flow 4 (link → sign in with Google → back to `/invite` → the definer's email-match check), which deletes G11's placement problem. **Increment 3 reduces to:** configure Google, add `email_verified === true` hardening to `evaluateSignIn()`, run a Flow 4 e2e through Google. `/no-organization` may gain "If you were invited, open the link in your invitation email." (S7)

**R4. Mail and the stored credential (G5/G6/G12).** Template key `account_invitation`, class **`account`** for every Increment 1 invitation (platform-originated), from the platform domain; link only from `platformOrigin()`. When DECISION-182's registry is built, `account_invitation` registers as `account` (amends R11/G20 "future invitations: org" for platform-originated invitations). For Increment 2, recommend `account` too (at most `org_fallback_only`, never the church's domain) — the operator's call. *(Orchestrator: operator Q2 answered "always presbyportal.org" on 2026-10-21 — `account` for all invitations, Increment 2 included.)* **Atomic queue link:** the invitation row, its `email_queue` row and the `email_queue_id` link in one transaction; `queue.ts` gains a transaction-aware insert plus a post-commit send attempt. **Body redaction:** when a row reaches `sent` (inline or worker) or `failed`, the same UPDATE replaces `html_body`/`text_body` with a marker for a closed `CREDENTIAL_TEMPLATE_KEYS` set (v1: `account_invitation`; `password_reset`, `email_change_verify`, `statistics_submission_grant` a TODO, F154). Minting at send time rejected (needs a worker-side definer to rotate hashes). Named residuals: the link is at rest while queued or retrying; Resend keeps its own copy; `to_email` stays in `email_queue`. Revoke/supersede marks a still-`queued` row cancelled. *(Orchestrator: operator Q6 answered "yes, scrub" on 2026-10-21.)*

**R5. Raw token at the function boundary.** Both functions take the **raw** token and hash it in SQL (`encode(sha256(convert_to(p_token,'UTF8')),'hex')`), so reading `token_hash` never confers the ability to claim — a deliberate divergence from DECISION-147 (whose functions take the hash while presby_app can SELECT `token_hash`; F153, verified live). Binding now because Increment 2 gives tenants SELECT on this table.

**R6. The token never travels through `callbackUrl`.** "Sign in to accept" is a server action setting an httpOnly cookie with the token (Secure in production, `SameSite=Lax`, `Path=/invite`, `Max-Age` 30 minutes), then redirecting to `/signin?callbackUrl=/invite` with no token. `/invite` reads the cookie when the query has none and clears it on accept or dead link. Otherwise the token lands in NextAuth's callback-url cookie, `/totp?callbackUrl=`, history and logs (F156). Page headers `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `noindex` via `next.config.ts` `headers()` scoped to the platform host (not the proxy).

**R7. Audit (G14) and `check:audit`.** Keys `invitation.created`, `invitation.resent`, `invitation.revoked`, `invitation.accepted` (`mode`, `invitationId`, `organizationId`, `purpose`, `personId`), `invitation.accept_blocked` (reason code), `user.created_via_invitation`; at acceptance the existing `org.founding_administrator.designated` / `org.treasurer.designated` with `viaInvitationId` and both inviter and accepting user recorded (Phase 3 picks the actor; both in the row); the tenant `organizationId` stamp stays (F18). IDs only — never the token, hash or recipient address. `check:audit` is structurally blind (walks only `src/app/**/actions.ts` for `db.*`); Rule 7 proven the DECISION-179 way — audit inserts in the mutation's own transaction, **one DB test per outcome** (created, resent, revoked, revoked-all, accepted per mode, each blocked reason).

**R8. Durable limits (G7)** from the table, on the platform connection, inside the issue transaction under the org-row lock: per inviter, per org, per recipient across orgs, the 5-minute resend cooldown and a per-chain cap. `/invite` POST keeps an IP-keyed `checkRateLimit` as a second layer, never keyed by token. In Increment 1 the cross-org recipient count isn't an oracle (only platform admins send); in Increment 2 it is (F155).

**R9. No self-designation.** The definer refuses when `accepted_user_id = created_by_user_id`; the send step refuses when the inviter's own email equals the invitee address. A platform admin who really is a church's administrator is designated by a different platform admin. Reverses Phase 1's "allowed, `inviterIsInvitee` stamped". **The operator must be told**; if they want self-designation it needs a CLAUDE.md amendment to Two Hierarchies, not a Phase 3 choice. Fixtures and dev testing use a second seeded admin.

**R10. Increment 2 is not designed here.** Its tenant write path, column-limited SELECT excluding `token_hash`, F155, and Q5 subset-rule feasibility need a Phase 2 addendum before its Phase 3; 0059 already provides the RLS shape.

## Suggestions

- **S1.** The preview reads no `users` row and always offers both "Create your account" and "Already have an account? Sign in to accept"; `account_exists` surfaces only on submit, to the token holder. If Phase 3 instead picks the primary button by account existence, name the forwarded-link disclosure as a residual.
- **S2.** Send-time checks: `isTotpConfigured()` for `treasurer` (G8); a `local_login` warning; a `do_not_contact` warning (G19). For the treasurer, resolve the person first (on-file email at the org, active membership, not merged, exactly one match — C6). Under C1, "no enumeration" is **UI uniformity** for platform senders (they can already read `/admin/users`); a secrecy boundary only in Increment 2 — write it that way so nobody over-engineers Increment 1.
- **S3.** Lift `insertAuditRow` to `src/lib/audit-tx.ts`, re-exported from `src/lib/domains/audit-tx.ts`.
- **S4.** A source-scan test: `src/lib/onboarding/accept.ts` and everything under `src/app/(invite)/` never import `getPlatformDb`; `issue.ts` imported only from `(admin)` (the `src/lib/giving/` idiom).
- **S5.** Add `"invite"` **and the missing `"file-statistics"`** to `RESERVED_SLUGS` (F157).
- **S6.** The 90-day address redaction as an owner-only sweep on the maintenance cron in a follow-up — a TODO now.
- **S7.** `/no-organization` copy for invited users (R3).
- **S8.** At Phase 6, Rule 15 likely applies: `docs/architecture.md:100` describes the first administrator as "a platform-mediated write" at `src/lib/founding-administrator.ts`; it becomes "a platform-issued credential the designee accepts, applied by a SECURITY DEFINER function", and the path moves.
- **S9.** The `queue.ts` transaction-aware insert and redaction are starter-generic — stage for `/downstream-sync`.

## Proposed decisions (for integration)

- **DECISION-183.** An account invitation is a DECISION-147 credential. Acceptance is one SECURITY DEFINER function on presby_app (`presby_accept_invitation`) that takes the raw token, derives org, purpose, address and person from its row, and creates or verifies the account, links the person, applies the designation and claims the row in one transaction, with no org GUC. `getPlatformDb()` never appears on the acceptance path. The founding-administrator and treasurer effects move to ungranted plpgsql helpers, the TypeScript transactions retired after a parity test. The holder gates and the founding-administrator bundle are single-sourced in owner-only SQL functions, the TypeScript copy pinned by test. Lock order: organization, invitation, user, person. An inviter may not accept their own invitation.
- **DECISION-184.** `account_invitations` (0059): FORCE RLS, `unique (id, organization_id)`, composite person key to `memberships`; one open row per (org, purpose, address); resend supersedes and never rotates; a freeze trigger whose accept transition requires the definer-armed marker; no DELETE grant and a cascade-aware delete guard binding the owner; presby_app holds EXECUTE on the preview and accept functions only; the preview masks the address in SQL.
- **DECISION-185.** New module `src/lib/onboarding/` (the two designation modules move in a pure-move commit; `issue.ts` platform-connection only, `accept.ts` presby_app only). New un-brandable route group `(invite)` with exact `PUBLIC_PATHS` entries `/invite` and `/invite/accepted`, no layout or loading boundary. The token never rides `callbackUrl`; a `Path=/invite` httpOnly cookie carries it across sign-in.
- **DECISION-186.** Template key `account_invitation`, class `account`, platform origin only (amends DECISION-182's R11 row). The queue row is written in the issuing transaction and sent after commit. Bodies of `CREDENTIAL_TEMPLATE_KEYS` are redacted on `sent`/`failed`; revoke or supersede cancels a still-queued row.
- **DECISION-187.** No invitation is applied from the `signIn`/`jwt` callbacks. The token is the sole acceptance credential; OAuth is only a way to be signed in for Flow 4 (amends Phase 1 C4/Flow 8/G11/Q8).

## Proposed findings

- **F153.** DECISION-147's functions take `p_token_hash`, and presby_app holds SELECT on `statistics_submission_grants.token_hash` and EXECUTE on `presby_submit_granted_return` (verified live) — the hash at rest is a bearer credential for any tenant session at the issuing presbytery. Low severity (the issuer already chooses the recipient). Follow-up: raw-token signatures.
- **F154.** `email_queue` holds credential links at rest indefinitely for `password_reset`, `email_change_verify`, `statistics_submission_grant`, with no RLS and full presby_app DML incl. DELETE (verified). Invitations close it for their own key only.
- **F155.** A cross-org per-recipient limit evaluated on an org-originated send is a one-bit oracle ("another organization recently invited this address") — binding on Increment 2's addendum: no sender-visible signal may depend on another org's rows.
- **F156.** Phase 1's Flow 4 put the token in `callbackUrl` (→ NextAuth's callback-url cookie, `/totp` URLs, logs). Closed by R6.
- **F157.** `RESERVED_SLUGS` has drifted: `file-statistics` (DECISION-147) was never added, and `invite` must be. A paper invariant with no route-tree test.

## Handoff

**Next: tech-lead (Phase 3).** Design within R1–R10; implementers database-admin (0059, the functions, the parity test, the test-rls section), api-developer (`onboarding/`, `queue.ts`, actions), ux-developer (`(invite)`, admin sections); the MFA e2e gate applies to both new-invitee and enrolled-existing-user paths. Before Phase 3 closes, put R3, R6 and R9 (and R1's Q1 dependency) in front of the operator with Q1, Q2, Q6.

**Doc edits for integration:** CLAUDE.md Permissions vs Flags — the credential sentence; CLAUDE.md The Brand Is a Cascade Override — add `(invite)` to the un-brandable list; `.claude/agents/architect.md` Route Group Rules — "`(invite)`: the public, token-consuming account-invitation flow (DECISION-183/185); the token is the credential; signed-in and anonymous visitors both; exact paths in `src/proxy.ts`'s public list; platform palette; no layout or loading boundary; never imports `getPlatformDb()`."

**Per-Phase Status:** | 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-21 |

---

## Operator ruling on R9 (2026-10-21)

**R9 is reversed by the operator: self-designation is allowed, audited.** A platform admin may accept a designation they sent themselves (the operator is currently the only platform admin and will be some churches' first administrator). Constraints for Phase 3: the acceptance still goes through the same token, email-match and confirmation as any invitee (the platform role confers nothing — authority comes only from the accepted invitation); the audit rows stamp `inviterIsInvitee: true` on both `invitation.accepted` and the `org.*.designated` event; the platform oversight list shows self-accepted designations distinctly. **CLAUDE.md → Two Hierarchies Intersect Nowhere is amended at integration** with one sentence: "A platform admin acquires tenant authority only as any person does — by accepting an invitation addressed to their own email; a self-sent designation is permitted and audited as such, and the platform role itself confers nothing." R3 (no automatic Google claim) and R6 (the cookie hand-off instead of `callbackUrl`) stand as ruled.

---

## Phase 2 addendum: rulings on Phase 3 divergences (architect, 2026-10-21)

*Recorded by the orchestrator. The architect is read-only and returned this section as text. It sits here so that Phase 2's rulings stay together; it was written after Phase 3.*

*Read-only. I read Phase 2 (R1–R10, S1–S9), the operator's R9 reversal and Phase 3 in full. Spot-checked the live tree in `presby-invites`: `users_email_unique` is a plain case-sensitive `UNIQUE("email")` (`drizzle/0000_initial.sql:113`). The guard triggers the accept function has to map raise generic SQLSTATEs (`foreign_key_violation`, `insufficient_privilege`), so the mapping cannot rely on the code alone.*

### Rulings on D-1 to D-8

- **D-1, `resent_from_id` + `resend_count` instead of `superseded_by_id`: Accepted with condition.** The reason holds. Pointing back from the new row avoids both a deferred FK and a second write to a row that is already frozen. It keeps the composite self-FK, and the chain cap comes free. **Condition (Batch 1a):** add a partial unique index on `(resent_from_id) where resent_from_id is not null`. A superseded row can then have at most one successor, so the chain is a line in the database, not a tree. **Condition (Batch 1c):** a DB test pinning the chain's consistency: the parent is `superseded_at`, has the same `purpose` and `email_normalized`, and `resend_count = parent + 1`. A `BEFORE INSERT` check that does the same is also acceptable. Without one of these, the per-chain cap trusts `issue.ts` alone. DECISION-184's "resend supersedes and never rotates" stands; the integration text should name `resent_from_id`, not `superseded_by_id`.
- **D-2, a second partial unique index `(organization_id, purpose) where purpose in ('founding_administrator','treasurer')` and every terminal timestamp is null: Accepted with condition.** It turns G1/Q4 into a database property. The `purpose in (...)` predicate keeps Increment 2 out of it, and F103 is unaffected because presby_app cannot insert. **Condition:** `issue.ts` maps a `unique_violation` on either partial index (matched by constraint name) to `already_pending`, not `db_error`. Resend's supersede-first-then-insert order has to stay as written: reversing it violates this index.
- **D-3, `presby_preview_invitation(p_token, p_user_id)` returning `session_matches`: Accepted with condition.** This is the right way to keep the full address out of app code. **Condition:** `p_user_id` comes only from the `auth()` session, never from form data or the query. The S4 source-scan should also assert that `previewInvitation` is called with the session id. With `p_user_id` null the function reads no `users` row (S1 preserved), and dead states still return zero rows regardless of `p_user_id`.
- **D-4, `isTotpConfigured()` at send for both purposes: Accepted.** It correctly extends S2, since new accounts default to `two_factor_required = true`.
- **D-5, refusals returned rather than raised; apply phase in a subtransaction: Accepted with two conditions.** Committing `blocked_at` requires returned outcomes. I endorse this.
  1. **Re-arm the marker on the exception path.** If the inner `begin … exception` block rolls back, any `set_config('presby.invitation_accept_active', …, true)` made inside it is rolled back too, because Postgres reverts GUC changes when a subtransaction aborts. The outer block's `blocked_at` update then hits the freeze trigger without the marker, raises, and the whole acceptance turns into `db_error` instead of `blocked`. The outer block must arm the marker immediately before its own `blocked_at` update and clear it immediately after. A Batch 1c test should drive a late trigger refusal (for example `memberships_guard_insert`) and assert `blocked_at` is committed.
  2. **Map exceptions narrowly.** `unique_violation` becomes `account_exists` **only** when `GET STACKED DIAGNOSTICS … CONSTRAINT_NAME = 'users_email_unique'`. Any other unique violation, such as an `app_roles` or `role_grants` conflict the `on conflict` forms missed, re-raises. Otherwise a schema bug tells the invitee "an account already exists" and leaves the token live in a loop. The trigger mappings likewise match SQLSTATE plus the message text (the codes are generic), and each mapping gets its own Batch 1c test. That suite already lists "each blocked reason", so this extends it rather than adding to it.
- **D-6, hand-off cookie not cleared on a dead link: Accepted.** Server Components cannot delete cookies. The cookie holds a dead token, is httpOnly, scoped to `Path=/invite` and expires in 30 minutes. The query token always wins over the cookie, as designed. Recording it as a TODO line is enough.
- **D-7, R9 reversal (no refusal; `inviter_is_invitee` returned and stamped in audit; the self-addressed send gets an extra confirm sentence): Accepted.** It matches the operator's constraints: same token, same email match, same confirmation, a 2FA-verified session for existing accounts, and `inviterIsInvitee` on both audit rows. My Phase 2 refusal is withdrawn. The governing text is the operator's Two Hierarchies sentence.
- **D-8, `email_queue_id` set at insert and immutable: Accepted.** It is tighter than R2.

### Contradictions Phase 3 does not list as divergences

1. **DECISION-183 text (must fix at integration).** Phase 3 records "DECISION-183–187: as proposed by the architect". My proposed DECISION-183 ends "An inviter may not accept their own invitation." The operator reversed that. **Required:** replace the sentence with "A self-sent designation is permitted, accepted through the same token, email match and confirmation as any invitee, and audited `inviterIsInvitee`; the platform role confers nothing." DECISION-184 also takes the D-1/D-2 wording. Otherwise the decision log contradicts the shipped behaviour and the amended CLAUDE.md.
2. **New-account existence check ignores case (Isolation / identity integrity).** Step 3, new mode, says "a `users` row with this email already → `account_exists`", and step 5 relies on `users_email_unique`. That constraint is case-sensitive. An existing `Foo@example.invalid` account would not stop a second account being created for `foo@example.invalid`. That second account could then take the invitation's authority, sidestepping the existing account's 2FA and the existing-account path. **Required:** the step 3 check is `lower(email) = email_normalized`, and the insert path keeps it (the `users` row lock does not cover a row that does not exist yet, so this check is what carries it; the narrow `account_exists` mapping in D-5 condition 2 is the race backstop for exact-case collisions). Add a Batch 1c test with a mixed-case existing account.
3. **Freeze-trigger scope widened without saying so.** Phase 3 also gates the `blocked_at` transition on the marker, which R2 did not. I accept it as tighter. It is the reason D-5 condition 1 matters.

I found no other silent departures:

- **Isolation:** presby_app holds no table grant and only two EXECUTEs. The acceptance path has no org GUC, and `accept.ts` and `(invite)` stay off `getPlatformDb` (S4).
- **Composite Tenant Keys:** `unique (id, organization_id)`, the composite person FK to `memberships`, the composite self-FK, and plain FKs to `users` only.
- **Two Hierarchies:** `granted_by` is provenance only. The resolver files and `presby_two_factor_required()` are pinned unchanged. Self-designation is handled per the operator's sentence.
- **Proxy:** two exact Set entries; `check:proxy-imports` is untouched.
- **(org) contract:** untouched. The post-accept redirect uses the slug from the function's row, and `/o/<slug>` authorizes itself.
- **Permissions vs Flags:** no new key or flag. `auth.local_login` goes through `isLocalLoginEnabled()` only, and `auth.require_2fa` is not read.

### Suggestions (non-blocking)

- Batch 1c: assert that no superseded row lacks exactly one successor. This catches an owner-path bug that supersedes without inserting.
- Keep the exception-mapping table in a comment beside the handler in `0059`, so a future guard-message edit visibly touches it.

### Gate

**Gate:** yes. Batch 1 (database-admin, migration 0059) may start as designed once Batch 0a is committed, with the conditions above built in: the `resent_from_id` unique index and chain test (D-1), `already_pending` mapping (D-2), session-only `p_user_id` (D-3), marker re-arm on the exception path and constraint-name-scoped mapping (D-5), and the case-insensitive new-account check (contradiction 2). The DECISION-183 text fix happens at integration.

---

## Phase 2 addendum 2: the hand-off cookie path (architect, 2026-10-21)

*Recorded by the orchestrator. The architect is read-only and returned this section as text. It was requested after Batch 3 found the hand-off cookie invisible on the return from sign-in.*

**Verdict: Approved with one required change.** Move the cookie to a host-only `Path=/` and remove `RecheckOnce`. This amends R6 and the cookie sentence in proposed DECISION-185. Nothing else in R6 changes: the token still never goes into `callbackUrl`, a URL, audit metadata or a log.

### Why Batch 3 hit this

Batch 3's diagnosis is right. A server-action redirect does not make the browser send a new request. Next renders the redirect target inside the action's own POST, and that POST carries only the cookies scoped to the action's path. The sign-in action already documents the same behaviour for the 2FA gate (`src/app/(auth)/signin/actions.ts` lines 30-40).

`/signin`, `/totp` and `/invite` have no path prefix in common except `/`. The redirect chain can also pass through `/account/2fa?callbackUrl=/invite`, for an account that must use 2FA but has not enrolled. So `Path=/invite` cannot reach the render that needs it, and any narrower path has to list every auth page the chain might cross.

### Ruling

1. **`src/lib/onboarding/invite-cookie.ts`:**
   - `inviteCookieOptions()` returns `path: "/"`, with **no `domain` attribute ever**. Keep httpOnly, `SameSite=Lax`, `Max-Age=1800`, and `Secure` in production.
   - The cookie name depends on the environment: `__Host-invite_token` in production, `invite_token` otherwise (the same pattern NextAuth uses for its secure-prefixed names). Export `inviteTokenCookieName(env)` in place of the bare constant.
   - The `__Host-` prefix makes the browser itself enforce "Secure, Path=/, no Domain". That means no future subdomain (P5's slug labels) can plant its own invitation token in this cookie.
   - Split the conflated constant. Add `INVITE_PAGE_PATH = "/invite"` and use it for every redirect in `(invite)/actions.ts`. The cookie path is just `"/"`.
   - `clearHandoffCookie()` keeps spreading `inviteCookieOptions()`, so the clear uses the same path and name.
2. **Remove `RecheckOnce`:** delete `recheck-once.tsx`, the `recheck` prop on `DeadLinkState`, and the special case for an empty token in `page.tsx`. An empty token goes back to the single dead-link render, which is byte-identical again. There should be one mechanism for this, not a mechanism plus a patch that hides it failing. The patch also has a cost of its own: a screen reader announces "This link isn't active" (`role="status"`) to someone who has just signed in correctly.
3. **Comments:** update `src/proxy.ts:27` and the comment in `invite-cookie.ts` to describe `Path=/`. The proxy's code does not change, and it still never reads the cookie.
4. **Boundary test:** extend `boundaries.test.ts` with a source scan. The cookie name may be referenced only in `invite-cookie.ts`, `(invite)/actions.ts` and `(invite)/invite/page.tsx`. Now that every platform request carries the cookie, only that scan keeps the reading of it confined to `(invite)`.

### What `Path=/` exposes

- **More requests carry it.** For up to 30 minutes it goes with every request to the platform host: pages, `/api/*`, `/site/<slug>` on the platform host, and same-origin assets. It is httpOnly, so no script can read it, including script on a tenant's public-site page. `SameSite=Lax` keeps it off cross-site POSTs and subresource requests. A top-level cross-site GET does carry it, but that only hands back the visitor's own token.
- **Logs.** The app does not log request headers, and Vercel's request logs do not record cookies. Any future tool that captures headers would capture the session cookie too, which is already `Path=/` and a stronger credential.
- **Custom hosts are unaffected.** A host-only cookie is never sent to a church's own domain. The rule that a custom host gets no session, cookies or platform routes still holds, and the proxy's custom-host branch is unchanged.
- **The proxy invariant is unaffected.** The proxy does not read the cookie and does not reach the database (DECISION-177).
- **D-6 gets slightly wider.** On a dead link the cookie is still not cleared, and it now goes with every platform request instead of only `/invite` requests. It is still inert: it holds a dead token and expires within 30 minutes. Update the TODO line for D-6 to say so.
- **Post-login landing is unaffected.** `callbackUrl=/invite` is an explicit, sanitized callback, like `/account/2fa`. `/launch` remains the fallback target, and `destination.ts` is not touched.

### Options rejected

- **Setting the cookie on several paths (`/invite`, `/signin`, `/totp`):** it has to list every auth page on the chain, including `/account/2fa` today and an OAuth callback later. It breaks silently the next time the auth flow changes.
- **Routing through `/launch?next=/invite`:** it changes the DECISION-044 matrix, depends on undocumented redirect-in-redirect handling, and puts `/launch`'s "we can't reach your congregations" page in front of the invite on a database blip.
- **Making the action redirect go through a route handler first:** how Next handles a server-action redirect to a `route.ts` is not documented.
- **Having the auth actions read the invite cookie:** this would tie the `(auth)` pages to the onboarding module.
- **Keeping `RecheckOnce` as the fix:** the wrong page still renders and is still announced.

### The test that pins it (Batch 4, written by the implementer)

Add to `e2e/invitation-existing-account.spec.ts`, in two cases. **Case A, no MFA:** open the invitation link, click "Sign in to accept", enter credentials, land on `/invite`, see the confirm state. **Case B, MFA-enrolled, self-designated:** the same, but enter the real `/totp` code before landing on `/invite`. In both cases:

- Before navigating, `page.addInitScript` installs a `MutationObserver` that sets `window.__deadSeen = true` if any `h1` containing "This link isn't active" is ever added. After "Accepting as … at …" is visible, assert `__deadSeen !== true`; also assert the dead-link heading count is 0 immediately on arrival at `/invite`, with no reload.
- Collect every request URL with `page.on("request")`; assert none contains the token.
- `context.cookies()` shows the hand-off cookie with `path: "/"`, `httpOnly: true`, `sameSite: "Lax"`, a domain equal to the exact host, and an expiry no more than 1800 s away. After Accept, the cookie is gone.

Unit tests: `invite-cookie` options (`path: "/"`, no `domain`, the name in each environment); update `actions.test.ts:250`; `page.test.ts`: an empty token renders the plain dead-link markup.

**Proof the test catches the bug:** the observer assertion fails on `af31f44` (the flash happens there even with `RecheckOnce`) and passes after the change. QA records fail-before / pass-after.

### Proposed decision and finding (orchestrator, at integration)

- **DECISION-185 (amend in place):** replace "a `Path=/invite` httpOnly cookie carries it across sign-in" with "a host-only, `Path=/`, httpOnly, `SameSite=Lax`, 30-minute cookie (`__Host-invite_token` in production) carries it across sign-in. The path is `/` because a server-action redirect renders its target inside the action's own request."
- **Proposed finding:** a server-action `redirect()` renders its target inside the action's own POST, so the target page sees only cookies scoped to the action's path. Any hand-off cookie that crosses an auth action has to be `Path=/`.

---

# Phase 3 — Technical Design (tech-lead)

*2026-10-21, tech-lead. Designs **Increment 1** only: platform designations (founding administrator, treasurer) plus the acceptance machinery. Increment 2 (org-level "Invite to sign in") is not designed here: R10 requires a Phase 2 addendum first, then its own Phase 3. Increment 3 reduces to configuring Google (R3). Read against the live tree of `presby-invites` (branch `pipeline/invitations`, `0057` the newest migration).*

**Inputs honoured.** Phase 2 R1–R8 and R10 as ruled; R9 as reversed by the operator (self-designation allowed, audited `inviterIsInvitee`); operator rulings Q1 (always pending), Q2 (all invitation mail from the platform domain, `account` class, Increment 2 included), Q6 (scrub the link after send; TODO for the other credential templates); Q3–Q5, Q7–Q10 at the analyst's defaults. No new `FEATURES` key, tenant permission, or platform flag (operator rule). Every divergence from an architect ruling or suggestion is listed in **Divergences from Phase 2** below with its reason. **No operator ruling is blocking** (two confirmations are listed under Handoff).

## Summary

A platform operator designating a founding administrator or first treasurer no longer looks the person up by account; they send a single-use, expiring invitation to an email address. The send step never reads `users`, so the sender's screen is identical whether or not the address has an account. The recipient proves they control the mailbox by holding the link, then either creates an account (name confirmation, password) or signs in to an account they already have, and in both cases clicks "Accept". Only then does one `SECURITY DEFINER` function (`presby_accept_invitation`, run on the RLS-enforced `presby_app` connection, no org GUC) create or verify the account, link or create the person, apply the designation and claim the invitation in a single transaction; the designation logic moves from two TypeScript platform-connection transactions into ungranted plpgsql helpers behind a parity test. The invitation is a DECISION-147-style credential: 32 random bytes, stored only as a SHA-256 hash, hashed in SQL from the raw token, never consumed on GET, never in `callbackUrl` (a `Path=/invite` httpOnly cookie carries it across sign-in), and scrubbed from `email_queue` once the message is sent. This closes the production blocker of 2026-10-21 ("the account did not exist yet") and removes the false "ask them to sign up first" copy (C5), and it turns a latent hazard (a mistyped email that matches a real account silently receiving administrator authority) into a consent step.

## Permissions & Flags

- **Permission key(s):** none new. Sending, resending, revoking, revoke-all and listing: existing `FEATURES.ADMIN_ORGANIZATIONS`, checked in each action body (`auth()` then `hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)`), exactly as the two `designate*Action`s do today. Acceptance: **no permission** — the token is the third access mechanism (DECISION-147/183); for an existing account the action additionally requires a session (and a 2FA-verified one when `twoFactorRequired`, G9). The token is never mapped into `FEATURES.*`, a session claim or the resolver.
- **Default role bindings:** unchanged (platform admins holding `admin.organizations`). No tenant key is added, so `foundingAdministratorPlan()` / `presby_founding_administrator_permission_keys()` and the F150/0057 backfill are untouched.
- **Feature flag(s):** **not needed** (operator rule: no new platform flag pre-live), and **no per-org toggle is needed either**: every send is an explicit act of a platform admin, so there is no rollout to stage. Kill levers without a flag: "Revoke all open invitations" per org (platform action, built in this increment), deploy revert (open tokens land on the dead-link page; pending rows are inert). Existing flags read: `isLocalLoginEnabled()` (fails open) for the accept page and the send-time warning; `auth.require_2fa` is **not** read (G9 uses the session's `twoFactorRequired`/`twoFactorVerified`).

## API Contract

### 1. SQL functions (migration `0059`; all `SECURITY DEFINER`, owner `neondb_owner`, `set search_path = public, pg_temp` per DECISION-148; every function `revoke all … from public, presby_app, presby_platform` first, then only the two grants named)

| Function | Grantee | Purpose |
|---|---|---|
| `presby_founding_administrator_holder_count(p_org uuid) returns int` | owner only | The roles.manage / role_grants.manage holder CTE, lifted verbatim from `founding-administrator.ts`. Single source for the send gate (`issue.ts` via `getPlatformDb()`), the page count, and the accept gate. Owner-only: a cross-org count is an oracle. |
| `presby_giving_manage_holder_count(p_org uuid) returns int` | owner only | The `giving.manage` effective-holder CTE (membership-aware), lifted verbatim from `treasurer-designation.ts`. |
| `presby_founding_administrator_permission_keys(p_org_type text) returns text[]` | owner only, `immutable` | The bundle (`base` + `congregation_oversight.manage` for a presbytery). `foundingAdministratorPlan()` stays as display copy, pinned equal by a DB test over every `organization_type` enum value read from the catalog (so a sixth type forces a conscious edit). |
| `presby_apply_founding_administrator(p_org uuid, p_person_id uuid, p_granted_by uuid)` | **none** (internal; called only from `presby_accept_invitation`) | Steps 1–2 and 7–10 of today's `designateFoundingAdministrator`: read org type fresh, holder gate, reuse-and-reactivate `founding_administrator` role (F109), office template read from the live row, additive-only permission reconcile (`on conflict do nothing`), person-arm grants with `granted_by` = the inviter (provenance only). Returns `(outcome text, administration_role_key text, office_role_key text, permission_keys text[])`; outcome `ok` or `has_holders`. The caller already holds the org-row lock. |
| `presby_apply_treasurer(p_org uuid, p_person_id uuid, p_granted_by uuid)` | **none** | Steps 1–2 and 5–7 of today's `designateTreasurer`: `not_applicable` (allow-list `congregation`, `new_worshiping_community`), holder gate, both templates read before any write (`provisioning_incomplete`), reuse-and-reactivate `treasurer` and `giving_recorder`, additive reconcile, one person-arm grant for `treasurer` only. Returns `(outcome, permission_keys text[], treasurer_role_id uuid, recorder_role_id uuid)`. |
| `presby_preview_invitation(p_token text, p_user_id uuid default null)` | `presby_app` | `STABLE`. Hashes `p_token` in SQL. **Zero rows for every non-live state** (unknown, expired, accepted, revoked, superseded, blocked, redacted). Otherwise one row: `organization_name, organization_type, purpose, invitee_first_name, invitee_last_name, person_display_name, masked_email, expires_at, session_matches boolean`. `masked_email` is computed in SQL (`left(local,1) || '***@' || domain`): the full address never reaches application code on the anonymous path (DECISION-153). `person_display_name` is the treasurer's roster name, or, for a founding administrator, the read-only email match at the org when it resolves to exactly one live person, else the invitee names. `session_matches` is `lower(users.email) = email_normalized` for `p_user_id` (null when `p_user_id` is null) — a boolean for the token holder, so the page can say "signed in as another account" without ever holding the invited address (a masked-string comparison would collide). Reads no `users` row when `p_user_id` is null (S1). |
| `presby_accept_invitation(p_token text, p_user_id uuid default null, p_password_hash text default null, p_first_name text default null, p_last_name text default null)` | `presby_app` | R1/R5. Raw token, hashed in SQL. Exactly one of `p_user_id` (existing account) / `p_password_hash` (new account) is non-null (else `raise` — a programmer error, not an outcome). Returns exactly one row: `(outcome, blocked_reason, invitation_id, organization_id, organization_slug, purpose, mode, user_id, person_id, person_mode, created_by_user_id, inviter_is_invitee, administration_role_key, office_role_key, permission_keys)`. |

Defaults trail every required parameter (`p_token` is the only required one): valid SQL. The two preview/accept signatures are the ACL targets; any later parameter change is a drop-and-recreate with the ACL re-applied in the same file.

**`presby_accept_invitation` algorithm (binding order; each step named because a reorder reopens a finding):**

1. Hash the token (`encode(sha256(convert_to(p_token,'UTF8')),'hex')`); read the invitation by hash, unlocked. None: return `outcome='dead'`.
2. Lock the **organization row** `for update`, then re-select the invitation `for update` and re-validate (all four terminal timestamps null, `expires_at > now()`). Else `dead`. Lock order for every writer, issue and accept alike: organization → invitation → users → person (no resend/accept deadlock).
3. **Existing mode:** lock the `users` row `for update` before any person read (this serializes acceptances for one account and stands in for the withheld `people.user_id` unique index, F110/F112). Missing row or `lower(email) <> email_normalized` → `email_mismatch`; `is_active = false` → `account_inactive`. **New mode:** check the hash shape (`^\$2[aby]\$\d{2}\$.{53}$`) and `lower(btrim(p_first_name/p_last_name))` length 1–100; a `users` row with this email already → `account_exists`.
4. **Gates, nothing written yet.** Treasurer: `presby_giving_manage_holder_count`, applicability, template presence. Founding administrator: `presby_founding_administrator_holder_count`, baseline provisioning (`groups.derived_from = 'active_membership'` exists). Then **person resolution**:
   - *Treasurer:* `person_id` is on the row; it must be live (`merged_into_id is null`, else `person_merged`), hold an active membership at this org (else `membership_ended`), and have `user_id` null or equal to the accepting account (else `person_linked_elsewhere`).
   - *Founding administrator:* (a) a live person already linked to the accepting account: at this org active → reuse; ended → `membership_ended`; elsewhere → `person_elsewhere`. (b) otherwise match `contact_methods` (`kind='email'`, `lower(btrim(value)) = email_normalized`) restricted to people with a membership at **this** org (the table has no org column; people are global): exactly one with an active membership and `user_id is null` → link; one with a different `user_id` → `person_linked_elsewhere`; ended membership → `membership_ended`; more than one → `ambiguous_person`; none → create a new person (invitee-confirmed names) with a `staff` membership (DECISION-128/129, no `roll_actions` row).
   Any refusal here: set `blocked_at`/`blocked_reason` (marker armed), write nothing else, return `outcome='blocked'` with the closed reason.
5. **Apply phase inside an inner `begin … exception` block** (a subtransaction, so a late failure leaves nothing behind): new mode inserts `users` (`email` = the invitation's address, `email_verified = now()`, `name` = first + space + last, defaults for `two_factor_required` etc.); person create or `update people set user_id = … where id = … and user_id is null` (row count must be 1) ; membership insert if created; `contact_methods.verified_at` on the matching address only; the `presby_apply_*` helper; then the claim `update` (`accepted_at`, `accepted_user_id`, `person_id`) with `set_config('presby.invitation_accept_active','on',true)` armed immediately before and cleared immediately after (DECISION-141 idiom). Exceptions map as the TypeScript catches did: `memberships_guard_insert` ("already exists elsewhere") → `person_elsewhere`; `role_grants_needs_membership` → `membership_ended`; "has no derived group active_membership" → `provisioning_incomplete`; `unique_violation` on `users.email` → `account_exists` (non-terminal); anything else re-raises (the whole transaction aborts; the caller returns `db_error`). A mapped *blocked* reason is committed by the outer block after the subtransaction rolled back.
6. Return `outcome='accepted'` with the row. `inviter_is_invitee := (accepted_user_id = created_by_user_id)`. **No refusal on self-acceptance** (operator ruling on R9).

**Outcome semantics.** *Non-terminal, nothing written, token stays live:* `account_exists` (offer "sign in to accept"), `email_mismatch`, `account_inactive`. *Terminal, `blocked_at` committed, nothing else:* `blocked` with `blocked_reason` in `has_holders | person_elsewhere | membership_ended | person_merged | person_linked_elsewhere | ambiguous_person | not_applicable | provisioning_incomplete`. *Uniform:* `dead` (unknown/expired/revoked/superseded/consumed/blocked) — one outcome, one row shape, one UI string (DECISION-147 bucket; identity-uniform, state-honest after the credential is proven, per the DECISION-152 split).

### 2. TypeScript library — `src/lib/onboarding/` (R-placement)

- `founding-administrator.ts`, `treasurer-designation.ts` (moved, Batch 0): after the parity test passes the two `designate*` transactions and `deriveNameFromUser` are **deleted**; the modules keep the display/gate surface: `foundingAdministratorPlan()`, `TREASURER_DESIGNATION_ORG_TYPES`, `treasurerDesignationApplies()`, and `countFoundingAdministratorHolders()` / `countGivingManageHolders()` rewritten as thin wrappers over the two SQL count functions (same exported signatures, so `page.tsx` is unchanged on this point).
- `invitation-token.ts` (pure, `node:crypto`, zero other imports): `mintInvitationToken(): { token: string; tokenHash: string }` (32 random bytes base64url, 43 chars; SHA-256 hex), `hashInvitationToken(token)`, `isWellFormedToken(s)` (`^[A-Za-z0-9_-]{43}$`; also the e2e fixture seam).
- `status.ts` / `labels.ts` (pure, client-safe): `deriveInvitationStatus(row, now) → 'pending' | 'accepted' | 'expired' | 'revoked' | 'blocked'` (`superseded` rows are hidden from lists), `INVITATION_STATUS_LABEL` ("Pending", "Accepted", "Expired", "Revoked", "Couldn't be completed"), `BLOCKED_REASON_OPERATOR_COPY`, `deliveryState(queueRow) → 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed' | 'cancelled'`.
- `invitation-email.ts`: `renderInvitationEmail({ firstName, organizationName, purpose, token, expiresAt }) → { subject, html, text }`. Link = `${platformOrigin()}/invite?token=${token}` only (null origin → the send refuses `link_origin_unavailable`); names `escapeHtml`'d and capped (100 chars); no sender free text; template key constant `ACCOUNT_INVITATION_TEMPLATE_KEY = "account_invitation"`.
- `issue.ts` (`import "server-only"`; **`getPlatformDb()` only**; imported only from `(admin)`):
  - `createInvitation(input: { organizationId; purpose: 'founding_administrator' | 'treasurer'; email: string; firstName?: string; lastName?: string; inviter: { userId: string; email: string | null }; acknowledgeDoNotContact?: boolean }): Promise<CreateInvitationResult>`
  - `CreateInvitationResult = { kind:'ok'; invitationId; expiresAt: Date; delivery: 'sent' | 'queued'; selfAddressed: boolean } | { kind: 'has_holders' } | { kind:'already_pending'; invitationId; expired: boolean } | { kind:'not_applicable' } | { kind:'provisioning_incomplete' } | { kind:'no_matching_person' } | { kind:'ambiguous_person' } | { kind:'membership_ended' } | { kind:'needs_acknowledgement'; reason:'do_not_contact' } | { kind:'totp_unavailable' } | { kind:'link_origin_unavailable' } | { kind:'invalid_input'; field } | { kind:'rate_limited' } | { kind:'db_error' }`
  - `resendInvitation(input: { organizationId; invitationId; actor })`, `revokeInvitation(input: { organizationId; invitationId; actor })`, `revokeAllOpenInvitations(input: { organizationId; actor })`, `listInvitationsForOrg(organizationId): Promise<InvitationListRow[]>` (derived status, delivery state joined from `email_queue`, `selfDesignated` = `accepted_user_id = created_by_user_id`, `blockedReason`, `canResendAt`; superseded rows excluded; full address shown to platform admins only while `redacted_at` is null).
  - **`createInvitation` transaction (R8 order):** mint token → lock organization row `for update` → org exists; purpose applicability (treasurer: allow-list); send-time gate via the owner-only SQL count function; baseline provisioning pre-check (founding administrator); treasurer person resolution **first** (C6: exact normalized email match on `contact_methods` among people with a membership at this org; zero → `no_matching_person`, more than one → `ambiguous_person`, ended-only → `membership_ended`); `isTotpConfigured()` (both purposes: new accounts default `two_factor_required = true`, so an unconfigured deployment would strand either invitee — extends S2, which named only the treasurer); `do_not_contact` check (G19) unless acknowledged; one open row per (org, purpose) (`already_pending`); durable limits (below); render email; **insert the `email_queue` row in the same transaction** (new `queue.ts` function), insert the invitation row with `email_queue_id` set at insert (never updated afterwards), insert the `invitation.created` audit row via `insertAuditRow(tx, …)` (never `recordAudit()`); commit; **then** the post-commit send attempt (`queue.ts`), whose failure leaves the row `queued` for the worker and returns `delivery: 'queued'` ("Email delivery is delayed; we'll keep trying"). The send step reads no `users` row.
  - **Durable limits (counted on `account_invitations` including superseded/revoked rows so churn cannot dodge them; evaluated inside the org lock):** per inviter 20 per rolling 24 h; per organization 10 per 24 h; per recipient address 3 per 24 h across all orgs (not an oracle in Increment 1 — only platform admins send; F155 binds Increment 2); resend cooldown 5 minutes from the latest row's `created_at`; at most 5 resends per chain (`resend_count`). One refusal literal for every limit: "Too many invitations right now. Try again later." Numbers live in one constants block in `issue.ts`.
  - **Resend** (`open` rows only, expired-open allowed): in one transaction, lock org, lock the old row, **supersede it first** (`superseded_at = now()`, which frees both partial unique indexes), then insert the new row (`resent_from_id` = old id, `resend_count` = old + 1, new token, new 7-day expiry, new queue row), cancel a still-`queued` old queue row, audit `invitation.resent`, commit, post-commit send. **Revoke:** terminal `revoked_at`/`revoked_by_user_id`, cancel a still-`queued` queue row (`status = 'cancelled'`), audit `invitation.revoked`. **Revoke-all:** the same per open row of the org (one audit row each, `via: 'revoke_all'`).
- `accept.ts` (`import "server-only"`; **`db` (presby_app) only, never `getPlatformDb`**; S4 source-scan):
  - `previewInvitation(token: string, userId?: string): Promise<InvitationPreview | null>` (one `select * from presby_preview_invitation($1,$2)`).
  - `acceptInvitation(input: { token: string; mode: { kind:'new_account'; firstName; lastName; password } | { kind:'existing_account'; userId; email: string | null } }): Promise<AcceptResult>`; validates (G17: password 8 min, **72 bytes max counted as UTF-8**; names 1–100 after trim, NFC, control characters stripped; token well-formed) *before* the database; **bcrypt (cost 10, as the reset path) is computed for every new-account submission before the token is looked up**, so a dead token costs the same as a live one; opens `db.transaction`, runs the function, and **in the same transaction** writes the audit rows (R7): `accepted` → `invitation.accepted`, `user.created_via_invitation` (new mode), and the `org.*.designated` event; `blocked` → `invitation.accept_blocked`; `dead`, `account_exists`, `email_mismatch`, `account_inactive` write no row (nothing to attribute). A failed audit insert rolls the whole acceptance back. Never logs the token, hash, password or address; `db_error` logs the error class only.
  - `AcceptResult = { kind:'accepted'; mode: 'new_account' | 'existing_account'; organizationSlug: string } | { kind:'dead' } | { kind:'account_exists' } | { kind:'email_mismatch' } | { kind:'account_inactive' } | { kind:'blocked'; reason: BlockedReason } | { kind:'invalid_input'; field: 'password' | 'firstName' | 'lastName' } | { kind:'db_error' }`.
- `queue.ts` additions (starter-generic, S9): `insertQueueRowInTx(tx, input): Promise<{ id }>` and `attemptQueuedSend(id): Promise<{ sentInline: boolean }>`; `enqueueEmail()` is re-expressed as their composition (behaviour-preserving; `queue.test.ts` stays green). `CREDENTIAL_TEMPLATE_KEYS = new Set(['account_invitation'])`; the three UPDATE sites that set `sent` (inline, worker) or `failed` (worker permanent failure) also set `html_body`/`text_body` to a fixed marker ("[Removed after delivery: this message contained a one-time sign-in link.]") for those keys. `cancelQueuedEmail(tx, id)`. `password_reset`, `email_change_verify`, `statistics_submission_grant` stay as a TODO (F154).

### 3. Server actions

`src/app/(admin)/admin/organizations/[id]/actions.ts` — `designateFoundingAdministratorAction` and `designateTreasurerAction` are **replaced** (every `no_such_user` string and the "ask them to sign up first" copy are deleted, C5):

- `inviteFoundingAdministratorAction(formData: FormData): Promise<InvitationActionResult>` — fields `organizationId` (uuid), `email`, `firstName`, `lastName`, optional `acknowledge`.
- `inviteTreasurerAction(formData): Promise<InvitationActionResult>` — `organizationId`, `email`, optional `acknowledge`.
- `resendInvitationAction(formData)`, `revokeInvitationAction(formData)` — `organizationId`, `invitationId`; the action verifies the invitation belongs to the org.
- `revokeAllInvitationsAction(formData)` — `organizationId`.
- `type InvitationActionResult = { ok: true; invitationId?: string; expiresAt?: string; delivery?: 'sent' | 'queued'; selfAddressed?: boolean } | { ok: false; error: string; needsAcknowledgement?: 'do_not_contact' }`. Every action: `auth()` → `hasFeature(ADMIN_ORGANIZATIONS)` → zod validation (`z.string().trim().toLowerCase().email().max(320)`, names 1–100) → `issue.ts` → `revalidatePath`. No `db.*` in this file (audit is written inside `issue.ts`'s transaction), so `check:audit` stays green and Rule 7 is proven by per-outcome DB tests (below), not by the tripwire (R7).

`src/app/(invite)/actions.ts` (no `auth()` for the new-account path; the existing-account action calls `auth()`):

- `acceptNewAccountAction(prev: AcceptFormState, formData: FormData): Promise<AcceptFormState>` — fields `token`, `firstName`, `lastName`, `password`, `confirm`. IP-keyed `checkRateLimit('invite_accept:<ip>', 10 per hour)` as a second layer (never token-keyed, like `stats_submit`); refuses if a session exists ("Sign out first, or sign in to accept this invitation"); on `accepted` clears the hand-off cookie and `redirect('/invite/accepted')`; every other outcome returns an inline-error state.
- `acceptSignedInAction(formData)` — field `token`; `auth()`; refuses unless `!(twoFactorRequired && !twoFactorVerified)` (G9); calls `acceptInvitation({ mode: existing_account })`; on `accepted` clears the cookie and `redirect('/launch?next=/o/<organizationSlug>')` (the slug comes from the function's row, never from the request).
- `startSignInToAcceptAction(formData)` — sets the cookie (below) then `redirect('/signin?callbackUrl=/invite')`. `continueToVerifyAction(formData)` — same cookie, then `redirect('/totp?callbackUrl=/invite')` (needed because a Server Component cannot set a cookie, and a signed-in visitor who arrives from the email has none yet). `switchAccountAction(formData)` — sets the cookie then `signOutAction('/invite')`.
- **Cookie (R6):** name `invite_token`, httpOnly, `Secure` in production, `SameSite=Lax`, `Path=/invite`, `Max-Age=1800`. The token never appears in `callbackUrl`, `/totp` URLs, audit metadata or logs.

### 4. Routes, proxy, headers

- `GET /invite?token=…` (page; token from the query, else the cookie): renders exactly one state — **dead link**; **anonymous** (both "Create your account" and "Already have an account? Sign in to accept" always shown, S1; the create form is replaced by "Password sign-in is turned off" when `isLocalLoginEnabled()` is false, G8); **signed in, session does not match** ("You're signed in as another account. Sign out to accept this invitation." + `switchAccountAction`); **signed in, 2FA required** (explains, `continueToVerifyAction`); **confirm** (matching, verified: "Accepting as <person name> at <org>" + Accept). GET consumes nothing and writes nothing. Metadata `robots: noindex`.
- `GET /invite/accepted` (static, accepts no token or parameter, like `/file-statistics/submitted`): "Your account is ready", button to `/signin?callbackUrl=/launch`.
- `src/proxy.ts` `PUBLIC_PATHS` gains exactly `"/invite"` and `"/invite/accepted"` (exact, no prefix). A source test asserts both are members and that `/invite/x` is not. Unreachable on church hosts (the custom-host branch returns before `PUBLIC_PATHS`, confirmed by the architect). `check:proxy-imports` unaffected.
- `next.config.ts` `headers()`: for `/invite` and `/invite/accepted`, scoped with `has: [{ type: 'host', value: PLATFORM_HOST }]` (the existing mechanism, line ~165), `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`.
- `RESERVED_SLUGS` gains `invite` and the missing `file-statistics` (F157), plus a route-tree test (every top-level `src/app` segment and route-group child is reserved or on an explicit exemption list).

### 5. Audit (`AUDIT_ACTIONS` appended in one block in Batch 2a; metadata is ids only — never the token, hash, password or address)

| Key | Written by | Actor | Metadata |
|---|---|---|---|
| `invitation.created` | `issue.ts` (tx) | the operator | `invitationId, organizationId, purpose, personId, expiresAt, selfAddressed, acknowledgedDoNotContact` |
| `invitation.resent` | `issue.ts` (tx) | the operator | `invitationId` (new), `supersededInvitationId, organizationId, purpose, resendCount` |
| `invitation.revoked` | `issue.ts` (tx) | the operator | `invitationId, organizationId, purpose, via: 'single' \| 'revoke_all'` |
| `invitation.accepted` | `accept.ts` (same tx) | the accepting user | `invitationId, organizationId, purpose, personId, mode, invitedByUserId, inviterIsInvitee` |
| `invitation.accept_blocked` | `accept.ts` (same tx) | the account when known, else null | `invitationId, organizationId, purpose, reason` |
| `user.created_via_invitation` | `accept.ts` (same tx), new mode only | the new user | `userId, invitationId, organizationId` |
| `org.founding_administrator.designated` / `org.treasurer.designated` | `accept.ts` (same tx), at acceptance only | the accepting user | existing metadata plus `viaInvitationId, invitedByUserId, inviterIsInvitee`; `resourceId` stays the organization id (F18) |

Both the inviter (`invitedByUserId`) and the accepting user (the actor) are on the designated row — this resolves the "Phase 3 picks the actor" item. `inviterIsInvitee: true` is stamped on `invitation.accepted` and on the `org.*.designated` row; `selfAddressed` at send is a best-effort email comparison, the accepted-time flag (id comparison) is authoritative.

### 6. Who sees what (copy contract; ux-developer owns final wording, tone from the analyst's Phase 1 lines)

- **Invitee, any dead state:** one string, "This link is no longer active. If you already accepted it, you can sign in. Otherwise ask whoever invited you to send a new one." (the sign-in hint is static text, so it distinguishes nothing). Identical markup and round trips for no-such-token, expired, revoked, superseded, used, blocked.
- **Invitee after the token is proven:** honest, plain-language messages per `blocked_reason` and for `account_exists` ("An account already exists for this address. Sign in to accept."), `email_mismatch`, `account_inactive`; `person_elsewhere` etc. are explained to the invitee in words ("this account is already linked to a person at another congregation; contact the person who invited you").
- **Platform operator (org page):** status vocabulary pending / accepted / expired / revoked / couldn't be completed with an operator-language reason, delivery state (queued, sent, delivered, "Bounced. Check the address", failed, cancelled), "Self-designated" badge when `accepted_user_id = created_by_user_id`.
- **Send refusals describe the org or the roster, never account existence** (Phase 1 Flow 1/2 sentences, including the lockout-recovery sentence for `has_holders` and "Nobody enrolled at this congregation has that email on file. The congregation's administrator enrols them first." for `no_matching_person`).

## Data Model

**Migration `drizzle/0059_presby_account_invitations.sql`** (hand-written, idempotent: drop-then-add CHECKs, `create or replace`, revoke-then-grant; applied twice on `pipeline-invitations` to prove replay, as 0057 was). Drizzle mirror `src/lib/db/domain/invitations.ts` (the `domain/index.ts` export is an integration edit, Rule 16; app modules import the file directly, as `founding-administrator.ts` imports `domain/org`). Not `email_queue`: **no change to that table** (the queue-row link lives on the invitation side, a plain uuid, 0056 precedent; `status = 'cancelled'` needs no schema change — it is unchecked text and the claim query reads only `'queued'`).

**Table `account_invitations`** (R2 as ruled, with the divergences listed below):

| Column | Type / rule |
|---|---|
| `id` | uuid pk default `gen_random_uuid()`; `unique (id, organization_id)` (Composite Tenant Keys) |
| `organization_id` | uuid not null → `organizations(id) on delete cascade` (reachable only through D10's guarded fixture teardown) |
| `purpose` | text not null, CHECK in (`founding_administrator`, `treasurer`) — Increment 2 widens |
| `origin` | text not null default `platform`, CHECK in (`platform`) — Increment 2 adds `org` |
| `email_normalized` | text, CHECK `= lower(btrim(...))`, length ≤ 320, contains `@`; **null iff `redacted_at` is not null** |
| `invitee_first_name`, `invitee_last_name` | text, length 1–100 when present; both required for `founding_administrator`; null for `treasurer` |
| `person_id` | uuid null; **required at insert for `treasurer`** (CHECK `purpose <> 'treasurer' or person_id is not null`); for `founding_administrator` null → value once, at accept |
| composite FK | `(person_id, organization_id)` → `memberships (person_id, organization_id)` (`memberships_person_org_key` exists; `people` is global, so the relationship row carries the tenant — verified); MATCH SIMPLE so a null `person_id` is unconstrained |
| `token_hash` | text not null **unique**, CHECK `~ '^[0-9a-f]{64}$'`; immutable, never rotated |
| `created_by_user_id` | uuid not null → `users(id)` (plain FK, as `role_grants.granted_by`) |
| `created_at` | timestamptz not null default `now()` |
| `expires_at` | timestamptz not null; CHECK `> created_at` and `<= created_at + interval '30 days'` (default 7 days is applied by `issue.ts`; no expiry picker in v1) |
| `email_queue_id` | uuid null, **no FK**; set at insert, immutable |
| `resent_from_id` | uuid null; composite self-FK `(resent_from_id, organization_id)` → `(id, organization_id)` |
| `resend_count` | int not null default 0, CHECK 0–5 |
| `accepted_at`, `accepted_user_id` | timestamptz / uuid → `users(id)` |
| `revoked_at`, `revoked_by_user_id` | timestamptz / uuid → `users(id)` |
| `superseded_at` | timestamptz |
| `blocked_at`, `blocked_reason` | timestamptz / text, CHECK `blocked_at is null = blocked_reason is null`, closed list (the eight reasons above) |
| `redacted_at` | timestamptz |

**CHECKs:** at most one of the four terminal timestamps (`accepted_at`, `revoked_at`, `superseded_at`, `blocked_at`) is non-null; `accepted_at` ⇒ `accepted_user_id` and `person_id` non-null, and `accepted_user_id` null otherwise; `revoked_at` ⇔ `revoked_by_user_id`; `redacted_at` ⇒ exactly one terminal timestamp (only a finished invitation can be redacted).

**Indexes:** both **partial unique indexes** share the predicate "all four terminal timestamps null" (expiry is derived and sits **outside** the predicate, so an expired-but-open row keeps blocking until a resend supersedes it or the operator revokes it, Flow 5): (1) `(organization_id, purpose, email_normalized)` (R2; the Increment 2 shape); (2) **`(organization_id, purpose) where purpose in ('founding_administrator','treasurer')`** — the database-level form of G1/Q4 "one pending designation per org and purpose regardless of address" (R2's index alone would let a second address in; the org-row lock made the app check race-safe, this makes it a database property, and Increment 2's new purpose is excluded from it by the `purpose in (...)` predicate). Limit indexes: `(email_normalized, created_at)`, `(created_by_user_id, created_at)`, `(organization_id, created_at)`. Per F103 the unique indexes are not an oracle (`organization_id` leads; presby_app cannot insert in Increment 1).

**Triggers (bind every connection, the owner included — F44; `revoke all` from public/presby_app/presby_platform):** `BEFORE UPDATE` freeze: identity columns (`id, organization_id, purpose, origin, token_hash, created_by_user_id, created_at, expires_at, email_queue_id, resent_from_id, resend_count`, invitee names) are immutable; terminal states are one-way and exclusive; `email_normalized` may only go non-null → null together with `redacted_at` on a terminal row; `person_id` may go null → value once, only on the accept transition; **the `accepted_at` and `blocked_at` transitions require the transaction-local marker `presby.invitation_accept_active`, which only `presby_accept_invitation` arms**; revoke, supersede, redaction are owner-path transitions (presby_app holds no UPDATE). `BEFORE DELETE` guard, cascade-aware (pass only when the organization row is already gone, i.e. fixture teardown; otherwise `insufficient_privilege`), the `presby_org_domains_guard_delete()` idiom from 0057 written out locally.

**RLS and grants:** `enable` + `force row level security`; policy `tenant_isolation` (`organization_id = presby_current_org()`) for Increment 2; `revoke all on account_invitations from public, presby_app, presby_platform`; `grant select … to presby_platform` (0049 idiom); **presby_app holds no table privilege at all**, only `EXECUTE` on `presby_preview_invitation(text, uuid)` and `presby_accept_invitation(text, uuid, text, text, text)`. Comments on the table and on the 90-day policy state **redaction is not enforced yet** (S6; the release note must not claim it); invitee names are retained after redaction (the person row already holds them for accepted invitations) — named residual.

**Staged test assets (Rule 16: the shared files are edited only at integration):** `scripts/invitations/test-rls-59.sql` (presby_app cannot read/write/delete rows; marker-less accept transition refused on the owner path; dead-link refusals return one shape; the gate and apply functions are not executable by presby_app or public) and `scripts/invitations/seed-dev-invitations.sql` (the `contact_methods` rows the dev fixtures lack, F159), merged by the orchestrator at integration. Note for the runbook: 0058 is reserved for Track F mail; 0059 may apply first, so the journal edit at integration must not assume contiguity.

## Component / Page Plan

**Pages to create** (`(invite)`, un-brandable, **no `layout.tsx`, no `loading.tsx`**; platform palette; `check:brand-scope` green with no edit):
- `src/app/(invite)/invite/page.tsx` (Server Component; reads token, `auth()`, `previewInvitation`, `isLocalLoginEnabled()`; renders one state), `src/app/(invite)/invite/accepted/page.tsx`, `src/app/(invite)/actions.ts`.

**Components to create:**
- `src/app/(invite)/invite/invite-states.tsx` (server components per state; preview header "A PresbyPortal administrator invited you to be <role> at <org>", masked address, expiry), `accept-form.tsx` (`'use client'`; plain `<form action={formAction}>` with `useActionState`, **not** react-hook-form, so it degrades before hydration; show-password toggle; focus to the heading or the error on every state change; inline `role="alert"` errors; labels tied to inputs; `autoComplete="new-password"`; 16 px inputs; 44 px targets; rules stated before typing; one column at 360 px; no colour-only status).
- `src/app/(admin)/admin/organizations/[id]/invitation-list.tsx` (`'use client'`; shared by both sections: rows with status text + icon, delivery state, address, sent/expiry, Resend, Revoke behind `AlertDialog`), `revoke-all-invitations.tsx` (`AlertDialog`, rendered only when at least one open row exists).
- `src/lib/onboarding/` modules from the API contract above.

**Files to modify:**
- `src/app/(admin)/admin/organizations/[id]/page.tsx` (read `listInvitationsForOrg`, `isLocalLoginEnabled()`, `isTotpConfigured()`; pass props; a pending invitation replaces the form), `actions.ts` (above), `founding-administrator-section.tsx` (email + first + last name; confirm dialog names the org, address and role, adds the self-address sentence and the local-login-off warning; the "must sign up first" hint (~lines 190–194) is removed, C5; `HydrationGate` added), `treasurer-designation-section.tsx` (email; button copy "Send invitation"; keeps `data-testid="treasurer-designation-section"`), the co-located tests.
- `src/lib/audit.ts` (six keys, one appended block), `src/lib/email/queue.ts`, `src/lib/email/index.ts` (barrel re-exports of the new queue functions), `src/app/(admin)/admin/email-queue/actions.ts` (**`retryEmailAction` refuses a row whose `templateKey` is in `CREDENTIAL_TEMPLATE_KEYS`**: a redacted body would be re-sent as the marker text; message points to Resend on the organization page; F158) and `page.tsx` (`VALID_STATUSES` gains `cancelled`), `src/proxy.ts` (two Set entries), `next.config.ts` (headers), `src/lib/reserved-slugs.ts`, `src/app/no-organization/page.tsx` (S7: "If you were invited, open the link in your invitation email."), `src/lib/giving/team.ts` and `scripts/test-rls.sql` (path comments only, at integration).
- Moves (Batch 0): `src/lib/founding-administrator.ts`, `treasurer-designation.ts` and their tests → `src/lib/onboarding/`; every importer found by grep (the `(admin)/admin/organizations/[id]` actions, page, sections and tests; `e2e/admin-organizations.spec.ts` comments; `src/lib/giving/team.ts`; `docs/` mentions at integration).

## Implementation Order

Gates for every batch: `npm run typecheck`, `npm run lint`, the batch's unit and DB tests (`--no-file-parallelism` for the DB subset, `.env.local` on the `pipeline-invitations` branch), and `npm run check` (all eight tripwires). No commit without operator approval; each batch below is one or more commits with the trailers from CLAUDE.md (`Work-Log: 2026-10-21-invitations`).

**Batch 0 — mechanical groundwork (api-developer), three commits, no behaviour change except the F157 fix**
- 0a `refactor(onboarding): move the designation modules` — the pure move plus importers (git mv, no content edits beyond import paths and path comments). Exit: typecheck, unit tests and the existing e2e specs untouched.
- 0b `refactor(audit): lift insertAuditRow to src/lib/audit-tx.ts` (S3; `src/lib/domains/audit-tx.ts` re-exports; both import paths work).
- 0c `fix(reserved-slugs): reserve invite and file-statistics` (F157) with the route-tree test. Trailers `Caught-By: agent-review`, `Discovered-In: Phase-2`.

**Batch 1 — schema (database-admin)**
- 1a `0059` table, CHECKs, indexes, freeze and delete triggers, RLS, grants, comments; Drizzle mirror; `check:schema-parity`; `npm run docs:erd`.
- 1b the functions in the order: three single-source functions → the two ungranted apply helpers → preview → accept; ACLs; dependency check (no existing `SECURITY DEFINER` body references anything changed — none is altered).
- 1c DB tests and staged scripts. **The parity test lands here, before any TypeScript deletion:** the same fixtures drive the existing TypeScript `designateFoundingAdministrator()`/`designateTreasurer()` and the SQL helpers, comparing the resulting `app_roles`, `app_role_permissions`, `role_grants`, `people`, `memberships` rows (ids and timestamps normalized), for every org type and for the F109 reuse-and-reactivate and additive-reconcile paths; it also freezes a **golden snapshot** of the expected rows, so the test survives the TypeScript deletion in Batch 2 as a pin. Other DB tests: freeze-trigger edges; delete guard (refuses a non-fixture org's row, passes the cascade); presby_app privilege and function-ACL negatives; owner and `proconfig` (search_path) pins; the six dead states return identical shapes and zero preview rows; accept for {new, existing} × {founding administrator, treasurer}; each blocked reason; each non-terminal outcome writes nothing (row-count snapshots of every touched table); concurrency (two parallel accepts one winner; accept vs revoke; accept vs resend; a resend/accept loop for lock order); the raw-token property (calling with the stored hash fails); `inviter_is_invitee`; the plan-vs-SQL bundle pin. Exit: 0059 applied twice cleanly; `scripts/invitations/test-rls-59.sql` passes as `presby_app`.

**Batch 2 — server (api-developer)**
- 2a token, email rendering, audit keys, `queue.ts` (transaction-aware insert, post-commit send, redaction, cancel) with unit tests; `queue.test.ts` and `src/app/api/cron/email-queue/route.test.ts` unchanged and green.
- 2b `issue.ts` plus durable limits, with **one DB test per outcome** (created, resent, revoked, revoked-all, and each refusal) asserting the audit row is in the same transaction and a failed audit insert rolls the change back; the unconfigured-origin, TOTP-unconfigured, do-not-contact and rate-limit refusals; a send whose provider call fails leaves the row `queued` with the link present and a later worker success redacts it.
- 2c `accept.ts` and `(invite)/actions.ts` (cookie, IP limit, 2FA check, redirects) with the per-outcome audit tests (accepted per mode, each blocked reason, none written for dead/non-terminal); admin `actions.ts` replacement; `retryEmailAction` refusal.
- 2d wiring and deletion: `PUBLIC_PATHS`, `next.config.ts` headers, TypeScript count wrappers over the SQL functions, then **delete** the two `designate*` transactions and `deriveNameFromUser` (only after the parity test is green in the same run). Source-scan tests (S4): `accept.ts` and everything under `src/app/(invite)/` never import `getPlatformDb`; `issue.ts` is imported only from `(admin)`; the four resolver files plus `presby_two_factor_required()` are unchanged (the existing "four files unchanged" assertion moves with the module).

**Batch 3 — UI (ux-developer)**: `(invite)` pages and form, admin sections, invitation list, revoke-all, `/no-organization` copy, component tests; **browser verification at a 360 px phone viewport** (Key Invariants → Verify in a Browser) of both `/invite` paths and both sections; `check:hydration-gate`, `check:brand-scope`.

**Batch 4 — end-to-end (api-developer for the fixture and the auth specs; ux-developer for the admin spec)**: see QA requirements and e2e blast radius below.

**Integration (orchestrator, serialized, Rule 16):** merge `scripts/invitations/test-rls-59.sql` into `scripts/test-rls.sql` and the seed block into `scripts/seed-dev.sql`; export `invitations.ts` from `src/lib/db/domain/index.ts`; `drizzle/meta/_journal.json`; DECISION-183–189 into `docs/decisions.md`; F153–F159 into `docs/schema-design.md`'s findings; TODO and STATE reconciliation; the CLAUDE.md and agent-file edits listed below; `docs/product/functionality-map.md` (Rule 14); `docs/architecture.md:100` (Rule 15, S8); run `scripts/test-rls.sql` against the merged `development` branch; the pre-deploy runbook for `0059` in `docs/deployment.md` (apply to production before the merge deploys, without `psql -1`, mirroring the 0057 runbook); release notes by `/release-notes` after Phase 6.

## Edge Cases & Risks

- **Treasurer needs an on-file email (F159, operationally important).** C6 resolves the treasurer by the email on `contact_methods`, not by account, and neither `e2e` fixtures nor `scripts/seed-dev.sql` contain a single `contact_methods` row, so the existing treasurer e2e designee (a person with a user link and no email) can no longer be designated, and in production a treasurer who was enrolled without an email will get "Nobody enrolled at this congregation has that email on file". Staff hire does capture a primary email (`createPerson`). The operator must confirm the first customer's treasurer is enrolled with an email before the acceptance test.
- **Existing accounts now consent.** Behaviour change for existing accounts (C1): an existing account is no longer designated instantly. Existing designations already made are untouched.
- **Cookie cannot be cleared from the page on a dead link** (a Server Component cannot delete cookies); it is cleared on accept and otherwise expires in 30 minutes, path-scoped, httpOnly, holding a token that is already dead. Diverges from R6's "clears it on dead link"; inert.
- **Idempotent double submit:** the button disables while pending; a genuine second POST after success meets a consumed token and gets the dead-link string, whose static hint ("If you already accepted it, you can sign in") covers that case without distinguishing states.
- **2FA is already enforced for new invitees without new code:** `users.two_factor_required` defaults true, `jwt()` recomputes `twoFactorRequired` (including arm B) from the database on every request, so a treasurer accepted from an existing non-2FA account is walked to `/totp` → `/account/2fa` by the proxy on `/o/*`; no `unstable_update` is needed after accept. `/invite` is public, so the page itself enforces G9.
- **Mail abuse and phishing:** platform-domain mail with operator-typed names: names escaped and capped, no free-text message, durable limits, the link built only from `platformOrigin()` (never `Host`). An unset or invalid production `NEXT_PUBLIC_APP_URL` makes the send refuse `link_origin_unavailable`.
- **Wrong or squatted address:** whoever controls the mailbox becomes the person. Mitigations in place: full address in the confirm dialog, named-person confirmation on the accept page, platform-originated sends only.
- **Forwarded link (accepted residual, as password reset):** a forwardee with no account sets a password and becomes that person; the operator sees "Accepted [date]" and can undo through role tools. Existing-account acceptance is bound to the invited address by `session_matches` / the function's email check.
- **Self-designation (operator ruling):** the operator is the only platform admin and will be some churches' first administrator. The platform role confers nothing: the acceptance still needs the emailed token, the email match, the confirmation click, and (existing account) a 2FA-verified session; audit rows carry `inviterIsInvitee: true`; the org page shows "Self-designated". Dev and fixtures may use either a second seeded admin or the same one.
- **Orphan outbound mail:** a revoked or superseded invitation whose email is still `queued` is cancelled in the same transaction; one already `processing` arrives dead.
- **Lock contention:** all invitation writes for an org serialize on its organization-row lock; acceptable at this volume.
- **Retention:** terminal rows keep the address until the owner-only sweep (S6) ships — a TODO now; do not claim 90-day redaction anywhere user-facing.
- **Worker redaction race:** the redaction is part of the same `UPDATE` that sets `sent`/`failed`, so there is no window where a delivered row still carries the link; a row stuck `queued` through retries (at most about three hours at the existing backoff) does.
- **Google (R3):** nothing is wired; `evaluateSignIn()` still never checks `email_verified` — an Increment 3 hardening item, unchanged here.
- **Increment 2 forward notes (not designed):** the subset rule (Q5) is feasible as `presby_effective_permissions(invitee_person, org, today)` read inside the inviter's `withOrgContext()` transaction (the function's org-argument guard is satisfied there) followed by `assertPermissionSubset(tx, inviterPersonId, orgId, inviteeKeys)`; needs the R10 Phase 2 addendum (tenant write path, column-limited SELECT excluding `token_hash`, F155) first.

## E2E blast radius (existing specs whose assertions this change alters)

- **`e2e/admin-organizations.spec.ts` — Test 7 (treasurer designation), all four tests and the 360 px describe.** The button ("Designate treasurer"), dialog ("Yes, designate") and success line change; "an account that is not a member … refused" becomes the roster message and needs a designee fixture with an on-file email; "designating a member makes the control disappear" no longer holds (a pending invitation panel replaces the form, the holder count stays zero, no grant, no role rows, the audit row is `invitation.created`); the shared `removeGivingDesignation()` cleanup is no longer what needs undoing. **Invitation rows cannot be deleted** (delete guard) except by deleting their organization, and the durable per-inviter/per-address limits would make repeated runs fail on permanent fixtures, so **every e2e path that creates or seeds an invitation uses a throwaway congregation** (`deletable_until`, the `e2e/support/custom-hosts.ts` `createSiteOrg` idiom) torn down at the end, which cascades the invitations. Test 7 is rewritten onto such an org (person + `staff` membership + `contact_methods` row, `people.deletable_until`).
- No other existing spec asserts designation behaviour (`grep` of `e2e/` for designate/founding/treasurer: the giving specs seed grants by SQL through `giving-fixture.ts`, unaffected). `e2e/admin-email-queue.spec.ts` should be re-read by the implementer for any assertion on rendered bodies or status filters.
- Unit/DB specs rewritten or moved: `founding-administrator.test.ts`, `treasurer-designation.test.ts` (kept as pins plus the golden parity), `organizations/[id]/actions.test.ts`, both section tests, `page.test.tsx`, `reserved-slugs.test.ts`, `email-queue/actions.test.ts`, `queue.test.ts` (unchanged but must stay green).

## QA requirements (Phase 5; this feature is auth-touching: `src/proxy.ts` is edited and the flow creates accounts and drives sign-in)

PASS requires the e2e suite run against a real dev server with an MFA-enrolled seeded user (`AUTH_TOTP_ENCRYPTION_KEY` and `RATE_LIMIT_DISABLED=true` set). A deferred or skipped e2e is BLOCKED. New specs (fixture `e2e/support/invitation-fixture.ts` follows DECISION-157: assert-and-throw guards — fixture org slug prefix, `example.invalid` emails, never a permanent org — and the cascade teardown order org → people → users):

1. **New-account path** (`e2e/invitation-new-account.spec.ts`): seed a founding-administrator invitation (known token hash, created by the `admin` fixture) to a fresh `*.example.invalid` address on a throwaway org → open `/invite?token=…`, reload twice (nothing consumed) → confirm names, a 7-character password rejected inline, a valid password → `/invite/accepted` → sign in → `/totp`/`/account/2fa` **enrolment** (the secret is in the `<pre>` under "Can't scan? Enter manually"; compute the code with `otplib`) → lands in `/o/<slug>`; assert the audit rows, the grant, and that the token appears nowhere in `audit_events` or `email_queue`; a second use of the link shows the dead-link page.
2. **MFA-enrolled existing-account path, self-designation** (`e2e/invitation-existing-account.spec.ts`): seed an invitation created by and addressed to the `mfa-enrolled` fixture (the production-shaped case) → link → "Sign in to accept" → credentials → **`/totp` challenge with the real code** → back at `/invite` (token via the cookie, never in the URL — assert) → Accept → `/launch` → `/o/<slug>`; assert `inviterIsInvitee: true` on `invitation.accepted` and the designated row, and the "Self-designated" badge on the org page; also a mismatch case (signed in as another fixture) and a treasurer purpose case.
3. **Send half** (admin spec on a throwaway org): send through the UI, assert the pending row, the `email_queue` row (recipient, `account_invitation`, status), and — because the body is scrubbed after send — that the stored body is the marker. The link shape (app origin, never a church host) is asserted by the `invitation-email.ts` unit test and a DB test with a failing provider (row stays `queued` with the link).
4. Existing specs per the blast radius above; `e2e/totp-full-login.spec.ts` and `post-login-routing.spec.ts` still green. One real-provider smoke through Resend test inboxes before go-live (the operator checklist covers it).

Feature-gate audit rows QA will check by reading bodies: the five admin actions (`auth()` + `ADMIN_ORGANIZATIONS`), `acceptSignedInAction` (`auth()` + 2FA gate), `acceptNewAccountAction` and the three cookie actions (deliberately anonymous, token-gated).

## Operator test-checklist additions (for the production acceptance checklist when this ships)

1. As platform admin, open an organization with no administrator: the founding-administrator form asks for email, first and last name; no sentence anywhere says "sign up first".
2. Send an invitation to an inbox you control: the page says "Invitation sent to … It expires on [date]. Nobody holds this role until it is accepted." A pending row shows the delivery state moving queued → sent → delivered.
3. The email arrives from the platform domain, the link host is the production app origin, the greeting names the recipient; it has no free text.
4. Open the link in a private window and reload twice: preview shows the congregation, the role and a masked address; the link is still live.
5. New-account path: a 7-character password is rejected inline; set a good one → "Your account is ready" → sign in → 2FA enrolment → land in the congregation; Roles shows the access; the audit page shows `invitation.created`, `invitation.accepted`, `user.created_via_invitation` and the designated row, with ids only (no address, no token).
6. Reuse the link: the same "no longer active" page as a made-up token.
7. Existing-account (self-designation) path: invite your own admin address to another congregation: Sign in to accept → 2FA challenge → Accept; the audit row says `inviterIsInvitee: true` and the org page shows "Self-designated". Also open a link while signed in as a different account: "signed in as another account" with a masked address and a sign-out button.
8. Resend and revoke: Resend within 5 minutes is refused; after a resend the old link is dead and the new one works; Revoke kills the link; send to a bounce-simulator address and the row shows "Bounced. Check the address".
9. Treasurer: with a congregation member enrolled with an on-file email, invite that address; with an address nobody has, the roster message appears. After delivery, `/admin/email-queue` shows the `account_invitation` row with the body removed, and Retry on a failed invitation row points you to Resend.
10. Day-one case: the account hand-created on 2026-10-21 — invite its address, choose "Create your account" (it answers "An account already exists… sign in to accept"), sign in with the password you set through /forgot-password, accept.
11. Repeat steps 4–5 and 7 on a phone (360 px wide).

## Divergences from Phase 2 (with reasons)

- **D-1. Resend lineage points forward-to-back, not back-to-forward (R2 ruled `superseded_by_id`).** The table carries `resent_from_id` + `resend_count` on the *new* row and `superseded_at` on the old. Reason: with `superseded_by_id` the old row must name a new row that cannot be inserted while the old one still occupies both partial unique indexes, which forces a deferred FK or a second UPDATE of the frozen old row; pointing the new row at the old one needs neither and gives the per-chain cap for free. Same composite-key discipline, same state vocabulary. *Architect: please acknowledge or direct otherwise before Batch 1.*
- **D-2. A second partial unique index `(organization_id, purpose)` for the two designation purposes** beyond R2's `(organization_id, purpose, email_normalized)`: G1/Q4 say a pending designation blocks a second regardless of address; this makes it a database property rather than only the org-lock app check.
- **D-3. `presby_preview_invitation` takes an optional `p_user_id` and returns `session_matches`** (R2 specified the preview columns without it) so the page never needs the full address to detect "signed in as someone else" (S1/DECISION-153 spirit; a masked comparison would collide).
- **D-4. `isTotpConfigured()` at send for both purposes** (S2 named the treasurer): new accounts default `two_factor_required = true`.
- **D-5. Accept refusals are returned, not raised,** for the non-terminal and terminal-blocked outcomes: R1 requires a gate conflict to commit `blocked_at` with nothing else written, which a raised exception would roll back; only the dead state is a single uniform outcome. The apply phase runs inside a subtransaction so a late trigger refusal also leaves nothing behind.
- **D-6. The hand-off cookie is not cleared on a dead link** (R6), for the reason in Edge Cases.
- **D-7. R9 reversal implemented as: no refusal, `inviter_is_invitee` returned by the function and stamped in audit; the self-address send step is allowed with an extra confirm sentence.**
- **D-8. `email_queue_id` is set at insert, not "set once" later** (the queue row is inserted first in the same transaction), a strictly tighter immutability than R2.
- Suggestions followed: S1, S2 (extended), S3, S4, S5 (in Batch 0c), S6 (TODO, not built), S7, S8, S9. R10 respected: no Increment 2 design.

## Feasibility check (against the live tree)

- **Signatures:** every new function has its required parameter first and only trailing defaults (`p_token`; `p_org`/`p_person_id`/`p_granted_by` have none). Valid SQL.
- **ALTER/DROP:** none against existing objects. 0059 only adds a table, triggers and functions; `email_queue` is untouched; no existing `SECURITY DEFINER` body is altered or depended on by a column change, so there is no silent request-time break. The TypeScript deletions are guarded by grep: importers of the two modules were enumerated (admin `actions.ts`, `page.tsx`, both sections and tests, `src/lib/giving/team.ts`, `e2e/admin-organizations.spec.ts` comments, `scripts/test-rls.sql`/`seed-dev.sql`/docs comments); `deriveNameFromUser` is referenced only by its own module and test.
- **CHECKs and triggers vs fixtures:** the new table is empty in `scripts/seed-dev.sql` and every e2e fixture, so no shipped fixture is refused; the freeze trigger only governs UPDATE, so seeded rows (including expired ones with explicit `created_at`) insert freely; fixture addresses are `example.invalid` and satisfy `check:secrets`. **One gap found:** no fixture has `contact_methods` rows (F159) — the staged `seed-dev-invitations.sql` and the e2e helper add them; `scripts/seed-dev.sql` itself is an integration edit.
- **FKs and tenant columns:** the tenant id is `organization_id` on `account_invitations`, `memberships`, and (through the composite) the self-FK; `memberships_person_org_key unique (person_id, organization_id)` exists, so the composite person FK is valid; `people` and `contact_methods` carry no tenant column (global), which is why person resolution always goes through `memberships`; plain FKs to `users` only.
- **Verified in the live code:** `jwt()` recomputes `twoFactorRequired` per request; `/account/2fa` shows the secret in a `<pre>`; `next.config.ts` already scopes headers with `has: [{ type: 'host', value: PLATFORM_HOST }]`; `retryEmailAction` would re-send a redacted body (F158); `createPerson()` records a primary email.
- **For the implementer to confirm on first read (named, not assumed):** the exact unique constraint behind `app_roles_org_key` for the `on conflict` form; which rows `org-provisioning.ts`'s `groupSeedPlan()` requires so the e2e throwaway org supports `memberships` inserts (`groups.derived_from = 'active_membership'`); that `/launch` honours `?next=/o/<slug>` for the existing-account redirect (the CLAUDE.md matrix says it does).

## Out of Scope

Increment 2 (org-level "Invite to sign in", "No login yet" markers, the subset rule's implementation, any tenant write path) and Increment 3 (Google); a cross-org invitation list (the "oversight" surface in this increment is the per-org panel with the Self-designated badge and revoke-all); bulk/CSV; SMS; free-text inviter message; auto-send on hire or grant; auto sign-in after accept; self-service "request access"; domain auto-join; the 90-day redaction sweep (S6); scrubbing the other three credential templates (F154); `person_identifiers` writes; breached-password checks or magic links; changing the account email during acceptance; statistics-grant links; the `requestEmailChange` "already in use" enumeration leak (existing, TODO); a custom expiry picker; an operator-facing "Resend" for terminal rows; Turnstile on the accept form (the token is the proof; the IP limit is the second layer).

## Proposed decisions and findings (for integration; the shared files are not edited here)

- **DECISION-183–187:** as proposed by the architect (Phase 2), with D-5 folded into 183 and D-1/D-2 into 184.
- **DECISION-188 (implementation).** The accept function's outcome contract: returned (not raised) outcomes, `blocked_at` commit semantics, subtransaction apply phase, non-terminal refusals write nothing, self-acceptance stamped not refused (operator ruling), `session_matches` in the preview.
- **DECISION-189 (implementation).** The issue-side protocol: queue row and invitation in one transaction with the link set at insert, post-commit send, redaction at `sent`/`failed`, the two partial unique indexes, resend lineage by `resent_from_id`, the durable-limit numbers (20/10/3 per 24 h, 5 min cooldown, 5 resends), the 7-day default and 30-day cap.
- **F158.** `retryEmailAction` resets a `failed` row to `queued` and would re-send a credential row whose body was redacted; it must refuse for `CREDENTIAL_TEMPLATE_KEYS`.
- **F159.** The roster-resolved treasurer flow depends on `contact_methods` emails that no seed or e2e fixture carries, and production data may lack for the treasurer; fixtures and the operator checklist must supply them.
- F153–F157 as proposed by the architect.

## Integration doc edits (orchestrator, at integration)

CLAUDE.md → Permissions vs Flags: the credential-as-third-mechanism sentence (architect's text); CLAUDE.md → The Brand Is a Cascade Override: add `(invite)` to the un-brandable list; **CLAUDE.md → Two Hierarchies Intersect Nowhere: the operator's R9-reversal sentence** ("A platform admin acquires tenant authority only as any person does — by accepting an invitation addressed to their own email; a self-sent designation is permitted and audited as such, and the platform role itself confers nothing."); `.claude/agents/architect.md` Route Group Rules: the `(invite)` bullet (architect's text); `docs/architecture.md:100` (S8); `docs/product/functionality-map.md`; `docs/TODO.md` lines for S6, F154, Increment 2, Increment 3, the `requestEmailChange` leak, the D-6 cookie note.

## Implementer

**Named, in order:** **api-developer** (Batch 0) → **database-admin** (Batch 1) → **api-developer** (Batch 2) → **ux-developer** (Batch 3) → **api-developer** (Batch 4: fixture and the two MFA auth specs) with **ux-developer** (Batch 4: admin spec rewrite and 360 px). No full-stack-developer: the schema and the anonymous write path are the risk and deserve a specialist each. Batches are serial in one worktree (shared files; Rule 16); Batch 1 may start as soon as Batch 0a is committed, since it needs only the moved module paths for the parity test.

## Handoff

**Operator confirmations (non-blocking; defaults stand if unanswered):** (1) the "oversight list" for self-accepted designations is the per-org panel's "Self-designated" badge, not a cross-org list; (2) before the production acceptance, confirm the first customer's treasurer is enrolled with an email on file (F159). **Architect:** acknowledge D-1 before Batch 1 starts. **Next: api-developer for Batch 0; database-admin may start Batch 1 once 0a is committed.**

---

# Phase 4 — Implementation

## Batch 0 — mechanical groundwork (api-developer, 2026-10-21)

**Status: Batch 0 complete, working tree uncommitted (awaiting operator approval).** Phase 3 calls for three commits (0a move, 0b audit lift, 0c F157 fix); the changes are separable by file and ready to be staged as those three commits.

## Files Created

- `src/lib/audit-tx.ts` (0b) — the `insertAuditRow` implementation, moved with `git mv` from `src/lib/domains/audit-tx.ts`; content unchanged (S3).
- `src/lib/domains/audit-tx.ts` (0b) — now a three-line re-export shim (`AUDIT_ACTIONS`, `insertAuditRow`, `AuditActor`) so both import paths work, as Phase 3 specifies.
- `src/lib/onboarding/` (0a) — new directory holding the four moved files below.

## Files Modified

0a — pure move (`git mv`), importers updated, no behaviour change:
- `src/lib/founding-administrator.ts` → `src/lib/onboarding/founding-administrator.ts` (content unchanged).
- `src/lib/treasurer-designation.ts` → `src/lib/onboarding/treasurer-designation.ts` (content unchanged).
- `src/lib/founding-administrator.test.ts` → `src/lib/onboarding/founding-administrator.test.ts`: header path and run-command comment only.
- `src/lib/treasurer-designation.test.ts` → `src/lib/onboarding/treasurer-designation.test.ts`: `ROOT` is now `../../..`, the source-scan reads `src/lib/onboarding/treasurer-designation.ts`, the two `./org-features` dynamic imports are `../org-features`, header and command comment.
- `src/app/(admin)/admin/organizations/[id]/{actions.ts, actions.test.ts, page.tsx, page.test.tsx, founding-administrator-section.tsx, founding-administrator-section.test.tsx}` — `@/lib/founding-administrator` and `@/lib/treasurer-designation` imports, `vi.mock` specifiers and path comments now point at `@/lib/onboarding/...` (the two founding-administrator section files carry comments only). The treasurer section files needed no change.
- `src/lib/giving/team.ts` — one path comment.

0b:
- `src/lib/domains/service.ts`, `src/lib/domains/toggles.ts` — import `AUDIT_ACTIONS, insertAuditRow` from `@/lib/audit-tx` instead of `./audit-tx`.

0c (F157):
- `src/lib/reserved-slugs.ts` — `RESERVED_SLUGS` gains `file-statistics` and `invite`; header documents the new route-tree test.
- `src/lib/reserved-slugs.test.ts` — two new tests (below).

**Not edited (Rule 16 integration-only, or integration-time doc edits per Phase 3):** `scripts/test-rls.sql:7924` still says `src/lib/founding-administrator.test.ts` (a comment); `docs/testing.md`, `docs/architecture.md`, `docs/STATE.md`, `docs/TODO.md`, `docs/decisions.md`, `docs/schema-design-2.md`, `docs/product/functionality-map.md`, `docs/release-notes/v0.35.md`, older work-logs and the shipped migrations `drizzle/0052`/`0057` still mention the old paths in prose; the orchestrator carries those at integration. `e2e/admin-organizations.spec.ts` needed no edit (it names only `data-testid`s, no module path).

## Schema Changes

- none (Batch 1 owns `0059`).

## Audit Events

- none written in Batch 0 (no new mutation; `insertAuditRow` behaviour is unchanged).

## Regression Tests Added

- `src/lib/reserved-slugs.test.ts` — "reserves every live top-level route segment in src/app — regression for RESERVED_SLUGS drift (F157)": walks `src/app` (flattening route groups, skipping dynamic/private/parallel segments) and asserts every live top-level segment is reserved. Verified failing before the fix (`["file-statistics"]` unreserved) and passing after.
- `src/lib/reserved-slugs.test.ts` — "reserves `file-statistics` and `invite` — regression for RESERVED_SLUGS drift (F157)": pins the two names, including `invite` before its route exists (also case-insensitively). Failed before, passes after.

## Batch 0 Gate Results (api-developer, 2026-10-21)

- `npm run typecheck`: pass. `npm run lint` (`--max-warnings=0`): pass. `npm run check` (all eight tripwires): pass.
- Unit (no DB): `src/app/(admin)/admin/organizations` (all 18 files), `reserved-slugs.test.ts`, `audit.test.ts`: 20 files, 339 tests, all pass.
- DB-backed, one file at a time against the `pipeline-invitations` branch (`--no-file-parallelism`): `onboarding/treasurer-designation.test.ts` 24/24, `onboarding/founding-administrator.test.ts` 32/32, `domains/toggles.db.test.ts` 8/8, `giving/team.db.test.ts` 24/24, `domains/service.db.test.ts` 101/101 across three runs (see next bullet).
- **Flake, not a regression:** a combined run of `src/lib/domains` + `src/lib/giving` in one process failed one `service.db.test.ts` test and then cascaded 48 failures and many skips (`describe.skipIf(!hasDb)` files) after a Neon connection timeout. Run alone, `service.db.test.ts` failed one different test each time with `Connection terminated unexpectedly` (a Neon connection drop, not an assertion); both tests that failed across the two runs pass when re-run on their own. The only change that file's subject sees is an import path (`./audit-tx` to `@/lib/audit-tx`). QA should run the DB subset one file per process.
- Regression tests fail before and pass after the F157 fix (see Regression Tests Added).

## Implementer Notes

- **Worktree had no `node_modules`;** ran `npm ci` inside `presby-invites` (no lockfile or `package.json` change; the `prepare` hook skipped hook installation because a worktree's `.git` is a file, so the pre-commit and commit-msg hooks are not installed in this worktree. The orchestrator should confirm hooks run at commit time).
- **0b lifts rather than copies:** `git mv` of the implementation to `src/lib/audit-tx.ts`, with `src/lib/domains/audit-tx.ts` recreated as the re-export. The two in-repo callers were switched to the new path (per the task); the shim keeps the old path working for anything that lands on a parallel branch.
- **The route-tree test covers directories only.** Files such as `robots.ts` produce a dotted URL (`/robots.txt`) that the DNS-label slug CHECK already refuses, so they are out of scope. The pre-existing `orgs` entry (no longer a page, a `next.config.ts` redirect) is deliberately left in the list.
- **The new route-tree test is the lasting fix for F157;** the `invite` pin is by name because the route does not exist until Batch 3, and should become redundant (not removed) when `src/app/(invite)/invite` lands.
- The moved DB-backed suites are slow (about 55 s for the treasurer file alone against the Neon branch); a combined run of the DB subset exceeds ten minutes, so run them one file at a time in the background.

---

## Batch 1 — schema (database-admin, 2026-10-21)

**Status: Batch 1 complete (1a, 1b, 1c), working tree uncommitted.** Built on Batch 0, which was committed while Batch 1 was in progress (`3c294fc`, `a423b40`, `6c73c08`, work-log `6434308`). Batch 1 did not touch, revert or restage any Batch 0 file. Suggested commits: `feat(invitations): migration 0059 and the account_invitations domain model` (1a+1b) and `test(invitations): Batch 1c DB, parity and RLS suites` (1c), each with `Work-Log: 2026-10-21-invitations`.

### Migration mode

**Hand-written:** `drizzle/0059_presby_account_invitations.sql`. Drizzle Kit cannot emit any of it (RLS, triggers, definer functions, revokes), and `db:generate` is broken repo-wide.

- **Transaction handling:** the file has **no `begin`/`commit` of its own**, unlike 0047/0057, because no existing function is dropped and re-created. Apply it **with `-1`**: `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0059_presby_account_invitations.sql`. A pure test pins this (`invitations.schema.test.ts`, "carries no top-level begin/commit").
- **Applied to:** Neon branch `pipeline-invitations` only (`br-mute-credit-axdunoa2`, endpoint `ep-autumn-mud-axr8kawo`). I checked this against `.env.local` before the first apply. Owner connection, direct endpoint. Never run against `development` or `production`.
- **Idempotence proof:** the file was corrected in place three times during Batch 1 (see Implementer Notes). After the last correction I applied the whole file twice more in a row. Both runs exited 0, with no change in row counts across `users`, `people`, `memberships`, `contact_methods`, `app_roles`, `app_role_permissions`, `role_grants`, `organizations` and `account_invitations`, and no change in a function-ACL fingerprint (13 ACL entries). The second run printed only the expected `already exists, skipping` notices. Base counts after all suites ran equal the pre-Batch-1 counts (users 32, people 763, memberships 125, role_grants 94, app_roles 102). The only additions are the staged seed's 3 contact rows and 6 invitations, so the test fixtures leaked nothing.
- **`_journal.json`:** **not edited** (integration-only, Rule 16). See Integration instructions for the exact entry.

### Files Created

- `drizzle/0059_presby_account_invitations.sql`: table, composite keys, 19 CHECKs, 6 indexes, 3 guards, FORCE RLS + `tenant_isolation`, grants, 7 functions, comments.
- `src/lib/db/domain/invitations.ts`: the Drizzle mirror. It has every column, both composite FKs (`foreignKey(...)`, including the self-FK), all named CHECKs and indexes, and exported enumerations (`ACCOUNT_INVITATION_PURPOSES`, `_ORIGINS`, `_BLOCKED_REASONS`, `_MAX_RESENDS`, `_MAX_EXPIRY_DAYS`, `_ACCEPT_MARKER`). The header names everything the builder cannot express and points at the 0059 section that enforces it.
- `src/lib/db/domain/invitations.schema.test.ts`: pure pin (10 tests). The migration's constraint and index names must equal the Drizzle declarations. The purpose, origin and blocked-reason CHECK lists must equal the TS enumerations. Every `v_block` the accept function can commit must be in the CHECK list. The file must have no begin/commit. presby_app must receive exactly the two EXECUTE grants. The marker must be armed only inside `presby_accept_invitation`, and exactly twice. The unique-violation arm must be scoped by constraint name.
- `src/lib/db/domain/invitations.db.test.ts`: owner-path and presby_app suite (66 tests). Coverage is listed below.
- `src/lib/onboarding/designation-parity.db.test.ts` + `src/lib/onboarding/designation-parity.golden.json`: R1 parity (12 tests) and the golden snapshot (11 scenarios).
- `src/lib/testing/invitation-fixture.ts`: test-support harness on `createCalendarFixture()`, reusable by Batch 2. It provides `mintToken()`/`hashToken()` (same shape as the planned `invitation-token.ts`), `insertInvitation()` (owner), `accept()`/`preview()` (**through the presby_app `db` connection**), `snapshot()` (an org- and address-scoped row-count snapshot for "nothing written"), `makeBareOrg()` (no derived group), and a `cleanup()` that also removes the people and users that acceptance created.
- `scripts/invitations/test-rls-59.sql`: staged `presby_app` section 59 (36 assertions).
- `scripts/invitations/seed-dev-invitations.sql`: staged dev fixture. It adds F159's `contact_methods` rows and 6 invitations with known tokens.

### Files Modified

- None outside the files above. `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `drizzle/meta/_journal.json`, `src/lib/db/domain/index.ts`, `docs/TODO.md`, `docs/decisions.md` and `docs/STATE.md` are untouched (Rule 16).

### Schema Changes

**Table `account_invitations`** (R2 as ruled, plus D-1, D-2 and D-8). Columns are exactly as in Phase 3's Data Model table: `id`, `organization_id` (cascade, fixture teardown only), `purpose`, `origin`, `email_normalized`, `invitee_first_name`/`_last_name`, `person_id`, `token_hash`, `created_by_user_id`, `created_at`, `expires_at`, `email_queue_id` (plain uuid, no FK), `resent_from_id`, `resend_count`, `accepted_at`/`accepted_user_id`, `revoked_at`/`revoked_by_user_id`, `superseded_at`, `blocked_at`/`blocked_reason`, `redacted_at`.
- **Keys:** `unique (id, organization_id)`; `unique (token_hash)`. `account_invitations_person_membership_fk`: `(person_id, organization_id)` → `memberships (person_id, organization_id)`, MATCH SIMPLE. `account_invitations_resent_from_fk`: `(resent_from_id, organization_id)` → `(id, organization_id)`. Plain FKs go to `users` and `organizations` only.
- **CHECKs (19, drop-then-add):** purpose and origin lists; email shape (lowercase, trimmed, ≤ 320, one `@`); email null iff redacted; names shape and names-by-purpose; treasurer has person; token-hash shape; expiry window (≤ 30 days); resend count 0–5; resend lineage (`resent_from_id is null` ⇔ `resend_count = 0`); at most one terminal timestamp; accepted shape (⇒ user and person); revoked shape; blocked shape; blocked-reason list; redacted ⇒ terminal.
- **Indexes:**
  - `account_invitations_open_address_uq` (R2).
  - **`account_invitations_open_designation_uq`** (D-2): `(organization_id, purpose) where purpose in (...)` and all four terminal timestamps null.
  - **`account_invitations_resent_from_uq`** (D-1): `(resent_from_id) where resent_from_id is not null`.
  - `account_invitations_email_created_ix`, `_inviter_created_ix`, `_org_created_ix` (R8 limits).
- **Guards (SECURITY INVOKER, search_path pinned, bind the owner):**
  - **`BEFORE INSERT`:** rows are born open. No terminal timestamp, no redaction, and no `accepted_user_id`, `revoked_by_user_id` or `blocked_reason` at insert. A founding-administrator row cannot name a person at insert. **The D-1 chain check:** the parent must exist in the same org, already be superseded, and have the same purpose, origin, address and person, and `resend_count` must equal parent + 1.
  - **`BEFORE UPDATE`:** NEW is compared with OLD after overlaying only the columns the one legal transition may change, so any unnamed column is frozen by default. The legal transitions are open→accepted (marker required; `person_id` may go null→value), open→blocked (marker required), open→revoked, open→superseded, and terminal→redacted.
  - **`BEFORE DELETE`:** passes only when the parent organization is gone (the 0057 idiom).
- **RLS and grants:** `enable` + `force`; `tenant_isolation` (using + with check on `presby_current_org()`). `revoke all … from public, presby_app, presby_platform`; `grant select … to presby_platform`. **presby_app holds no table privilege.**
- **Functions (all SECURITY DEFINER, owner `neondb_owner`, `search_path = public, pg_temp`, revoked from PUBLIC, presby_app and presby_platform first):**
  - `presby_founding_administrator_holder_count(uuid)`, `presby_giving_manage_holder_count(uuid)` and `presby_founding_administrator_permission_keys(text)`: owner only. The two counts are lifted verbatim from the TS CTEs. The bundle is pinned against `foundingAdministratorPlan()` for every `organization_type` enum value read from the catalog.
  - `presby_apply_founding_administrator(uuid,uuid,uuid)` and `presby_apply_treasurer(uuid,uuid,uuid)`: ungranted, and step-for-step ports of the TS transactions. Each re-checks its own gate and returns a non-`ok` outcome rather than raising.
  - `presby_preview_invitation(text, uuid default null)`: STABLE. Zero rows for every non-live state. Masks the address in SQL. With a null `p_user_id`, `session_matches` is null and no `users` row is read (D-3).
  - `presby_accept_invitation(text, uuid, text, text, text)`: the Phase 3 algorithm in its binding order, with the addendum conditions built in:
    - **D-5.1:** the outer block re-arms the marker immediately before its `blocked_at` update and clears it immediately after.
    - **D-5.2:** the exception handler matches SQLSTATE **and** the constraint name or message text, and carries a comment table beside it. `unique_violation` maps to `account_exists` **only** when `CONSTRAINT_NAME = 'users_email_unique'`. The handler also covers 42501 `memberships_guard_insert` → `person_elsewhere`, 23514 `role_grants_needs_membership` → `membership_ended`, 23503 `memberships_sync_derived_group` → `provisioning_incomplete`, and P0001 `apply refused` (an apply helper's own gate) → that reason. Every other exception re-raises.
    - **Contradiction 2:** the new-account existence check is `lower(u.email) = email_normalized`.
  - **EXECUTE goes to presby_app on preview and accept only.**

### Audit Events

- **None are written by the database layer** (R7: `accept.ts` writes them in the same transaction, Batch 2c). The accept function returns everything those rows need:
  - `invitation.accepted`: `invitation_id`, `organization_id`, `purpose`, `person_id`, `mode`, `created_by_user_id` (→ `invitedByUserId`), `inviter_is_invitee`.
  - `user.created_via_invitation`: `user_id` when `mode = 'new_account'`.
  - `org.founding_administrator.designated`: `person_id`, `user_id`, `person_mode` (→ the existing `mode` field), `administration_role_key`, `office_role_key`, `permission_keys`.
  - `org.treasurer.designated`: `person_id`, `treasurer_role_id` (→ the existing `roleId` field), `permission_keys`.
  - `invitation.accept_blocked`: `invitation_id`, `organization_id`, `purpose`, `blocked_reason`, and `user_id` (the account in existing mode, null in new mode).
- Non-terminal and `dead` outcomes return `outcome` only, with every other column null, so there is nothing to attribute (matching Phase 3).

### Regression Tests Added (Batch 1c)

**Test counts (one file per process, `--no-file-parallelism`, against `pipeline-invitations`):**

| Suite | Tests | Result |
|---|---|---|
| `src/lib/db/domain/invitations.db.test.ts` | 66 | 66 pass |
| `src/lib/onboarding/designation-parity.db.test.ts` | 12 | 12 pass |
| `src/lib/db/domain/invitations.schema.test.ts` (pure, no DB) | 10 | 10 pass |
| `scripts/invitations/test-rls-59.sql` as **presby_app** | 36 assertions | exit 0 |
| `src/lib/onboarding/founding-administrator.test.ts` (unchanged; TS pins) | 32 | 32 pass |
| `src/lib/onboarding/treasurer-designation.test.ts` (unchanged; TS pins) | 24 | 24 pass |

**`invitations.db.test.ts` coverage** (calls go through the presby_app `db` connection, exactly as `accept.ts` will):

- **Structure and ACL:** FORCE RLS and the one policy. presby_app has no table or column privilege; presby_platform has SELECT only. EXECUTE exactly as ruled, and PUBLIC executes nothing. Definer, owner and search_path pins. The three guards are present, and no other trigger exists. Through presby_app, the table, the counts and the apply helpers are all refused.
- **Guards (owner path):** pre-terminal inserts refused (4 variants); a founding-administrator row with a person at insert refused; the accept and blocked transitions refused without the marker, with a rolled-back positive control showing that with the marker they pass; 7 identity edits refused; revoke allowed and then frozen except for redaction; an open row cannot be redacted; delete refused while the org exists, and the teardown cascade passes; D-2 (a second open designation at the same org refused for a different address and for the same address, a different purpose allowed, an expired-open row still blocks, a revoked row does not); CHECKs.
- **Resend chain (D-1):**
  - The insert guard refuses an unsuperseded parent, a wrong count and a different address.
  - A second successor is refused by `account_invitations_resent_from_uq`.
  - The cap: a sixth resend is refused by the CHECK.
  - **The consistency invariant over a real 3-resend chain:** every parent is superseded, with the same purpose and address and count = parent + 1. Every superseded row has exactly one successor (the architect's suggestion), and only the head is live.
- **Single sources:** the SQL bundle equals `foundingAdministratorPlan()` for every enum value in the catalog. The SQL counts equal the TS counts across holder shapes, including the lifted asymmetry: an ended membership still counts as an FA holder, but no longer as a giving holder.
- **Preview:**
  - The masked address appears, and the full address appears nowhere in the row.
  - `session_matches` is null without a session, true for a mixed-case match and false for another account.
  - The display name: the treasurer's roster name; for a founding administrator, the on-file match.
  - Zero rows for 9 non-live tokens: unknown, empty, null, **the stored hash (R5)**, expired, revoked, superseded, accepted and blocked.
  - Preview writes nothing.
- **Dead bucket:** 12 calls (6 dead tokens × both modes) return identical shapes: `dead`, with every other column null. The programmer-error raises (both or neither of user id and password hash, a bad hash, a blank name) do not change the row.
- **Accepted:**
  - New account × founding administrator: the users row, the person, the staff membership, both grants with `granted_by` = the inviter, the claim, and single use.
  - New account × treasurer: the link, `contact_methods.verified_at`, the grant, and `giving_recorder` minted but not granted.
  - Existing **mixed-case** account × founding administrator.
  - Existing account × treasurer, reusing the already-linked person.
  - Existing account × founding administrator, reusing the account's own person at the org.
  - G3: a founding administrator's on-file address match is **linked**, not duplicated.
  - A presbytery gets the office half and the presbytery bundle; a synod gets no office half.
  - **Self-acceptance:** `inviter_is_invitee = true`.
- **Non-terminal outcomes write nothing** (snapshot equality, invitation row unchanged, token still live): `account_exists` with exact case; **`account_exists` for a mixed-case existing account, with exactly one users row for that address afterwards (addendum contradiction 2)**; `email_mismatch` for another account and for a missing account; `account_inactive`.
- **Each blocked reason at step 4** (`blocked_at` committed, snapshot otherwise equal, the link dead afterwards):
  - `has_holders`, for the founding administrator and the treasurer (existing mode reports `user_id`).
  - `not_applicable`.
  - `provisioning_incomplete`, for the founding administrator on a bare org and for the treasurer with a missing template (owner path, rolled back).
  - `person_merged`.
  - `membership_ended`, three ways.
  - `person_linked_elsewhere`, two ways.
  - `person_elsewhere`, two ways.
  - `ambiguous_person`, two ways.
- **Every exception-mapping arm through the REAL guard that raises it (D-5).** A test-only trigger function, armed by a transaction-local GUC and inert otherwise, changes the world between step 4 and the write that the real guard then refuses with its real message. It is created in `beforeAll` and dropped in `afterAll`, on the pipeline branch only.
  - `memberships_guard_insert` → `person_elsewhere`, **with `blocked_at` read back on a different connection after the presby_app commit, and the subtransaction's account, person and memberships verified gone (D-5.1)**.
  - `role_grants_needs_membership` → `membership_ended`.
  - `memberships_sync_derived_group` → `provisioning_incomplete`.
  - An apply helper's own gate → P0001 → `has_holders`.
  - `users_email_unique` race → `account_exists`, non-terminal, with nothing written.
  - **Any other `unique_violation` re-raises** (never `account_exists`).
  - An `insufficient_privilege` with any other message re-raises.
- **Concurrency:** two parallel acceptances produce one winner and one `dead`, with one users row. Accept vs revoke holding the org lock: the accept is `dead`. Accept vs resend: the old token is `dead` and the new one accepts. A three-round resend/accept loop on one org completes with no deadlock.

**Parity (`designation-parity.db.test.ts`):** each scenario builds two identical throwaway orgs. On one it runs the TS transaction; on the other it runs `presby_accept_invitation` (existing account). It then compares normalized `app_roles` (key, name, kind, protected, active, sorted permissions), `role_grants` (role, principal, granted_by, reason, starts/ends), the designee person and the membership.
- **SQL == TS** for:
  - the founding administrator with a created person at all 5 org types;
  - the founding administrator with an existing person at the org;
  - F109 reuse-and-reactivate with an additive-only reconcile, at a congregation (a congregation-added key survives on both roles) and at a presbytery (the congregation's renamed office role keeps its name);
  - the treasurer at congregation and new_worshiping_community;
  - treasurer F109 for both roles, keeping the template's constitutional kind and protected flag.
- **SQL == golden** for the same 11 scenarios, plus a test that the golden has no stale entries.
- **The golden survives Batch 2d.** Batch 2d deletes the SQL == TS half of each scenario (the `designate*` calls) and keeps `pin()`'s golden comparison. Regenerating (`WRITE_DESIGNATION_GOLDEN=1`) needs a recorded ruling.

**Failing-first proofs** (each: open the hole on the pipeline branch, run the targeted test or section, cite the failure, restore by re-applying 0059 or re-enabling the trigger, and confirm green):

| Mechanism | How it was broken | Failure observed |
|---|---|---|
| presby_app has no table privilege (test-rls 59b) | `grant select on account_invitations to presby_app` | `test-rls-59.sql:106` `FAIL 59b: presby_app holds no privilege of any kind … expected 0, got 1` |
| owner-only counts (59c) | `grant execute on presby_giving_manage_holder_count(uuid) to presby_app` | `test-rls-59.sql:166` `FAIL 59c: and nothing else … expected 0, got 1` |
| preview zero rows for dead states (59e) | preview with its `expires_at > now()` predicate removed | `test-rls-59.sql:235` `FAIL 59e: every dead state previews as ZERO rows … expected 0, got 1` |
| **D-5.1 marker re-arm** | accept with the outer `set_config` before the blocked update removed | "memberships_guard_insert (42501) … COMMITTED" fails with 42501 from `presby_account_invitations_guard_update()` at the blocked update. The whole call errors, exactly the failure the architect predicted |
| **contradiction 2, `lower(email)`** | existence check changed to `u.email = …` | "MIXED-CASE existing account blocks …": `expected 'accepted' to be 'account_exists'`. A second account was created |
| **D-5.2 constraint scoping** | `if v_con = 'users_email_unique'` → `if true` | "ANY OTHER unique_violation re-raises": `expected a raise … expected null not to be null` (it was swallowed as `account_exists`) |
| update guard (marker binds the owner) | `disable trigger account_invitations_guard_update` | "refused WITHOUT the marker, even for the owner": `expected a raise matching /accepted only through presby_accept_invitation/` |
| insert guard (D-1 chain) | `disable trigger account_invitations_guard_insert` | "a resend must follow a SUPERSEDED parent …": `expected a raise matching /resend must follow/` |

After all proofs I applied 0059 twice more (the idempotence proof above). All three triggers were confirmed `tgenabled = 'O'`, and test-rls-59 is green (36).

### Gate Results (database-admin, 2026-10-21)

- `npm run typecheck`: pass. `npm run lint` (`--max-warnings=0`): pass. `npm run check` (all eight tripwires): pass.
- `check:secrets` scans **tracked** files only, and the new files are untracked. I ran its exported `checkSecretsPii()` over `git ls-files --others --exclude-standard`: no findings in the 9 new files.
- **Schema parity with the new file included.** `check:schema-parity` imports `src/lib/db/domain/index.ts`, which I may not edit. A scratch copy of the script that also imported `./invitations` (run, then deleted) reported 85 domain tables compared, 7 differences, all 7 allowlisted and pre-existing, 0 failing. The unmodified script reports 84 tables with the same 7 differences, so `account_invitations` matches columns, nullability and both composite FKs with zero drift.
- **Flakes, not regressions.**
  - In the first full run, one test ("an OPEN row cannot be redacted", two owner statements) timed out at 20 s. On re-run it passed in under a second: a Neon stall.
  - The parity file's first scenario once exceeded 20 s on a cold pool, so that file sets `testTimeout: 60_000`.
  - In the final serial run, the parity file lost two scenarios to `Connection terminated unexpectedly` inside the TS transaction (the TS side returned `db_error`). Re-run singly: 12/12. Row counts afterwards still equal baseline.
- **The shared `scripts/test-rls.sql` cannot run end to end on `pipeline-invitations`, for a pre-existing reason unrelated to Batch 1.** It stops at section 2, line 127: `FAIL alder: sees own memberships — expected 9, got 10`. The extra Alder Creek membership was created on **2026-10-14**, a week before this pipeline. It is a demo-account row inherited from `development` when the branch was forked, not a fixture, and Batch 1 wrote nothing at Alder Creek. The suite sets `ON_ERROR_STOP` itself, so nothing after section 2 runs on this branch. To still prove the one catalog-wide sweep 0059 could break, I ran **C-3** (line ~5600: "every table in schema public carries FORCE ROW LEVEL SECURITY except the 26 named") in isolation as presby_app. It passes (0), as does its staleness twin (26). Sections 36 and 40 are name-listed and cannot see the new functions. **For integration:** the post-merge full run on `development` will hit the same section-2 assertion if that branch still carries the demo membership. Reconcile the count, or the row, before treating the full suite as the gate.

### Implementer Notes

- **Bug found and fixed in Batch 1's own function, by its own tests (no shipped code affected).** In existing-account mode with no live person linked to the account anywhere, `select p.id, true into v_person, v_found … limit 1` matched no row. PL/pgSQL then set `v_found` to NULL, not false, so `if not v_found` was false and person resolution was skipped. The grant then hit `role_grants_principal_check` with a null person, and the call errored. **Fix:** test `FOUND` immediately after each `SELECT INTO`. I also added an internal invariant inside the subtransaction: if no person or account is resolved, raise `internal_error`, which is unmapped, so `db_error`. Caught by "existing account (MIXED-CASE email) × founding administrator" and "self-acceptance". This is one of the three in-place corrections. The others were: a `collate "C"` sort so the treasurer key order matches the TS `.sort()` byte order, and a plain local in place of `SELECT INTO` a field of a not-yet-assigned record.
- **The three-way lock order** is implemented exactly as ruled: organization → invitation (`for update`, re-validated) → users (`for update`, existing mode) → person (`for update`).
- **Holder-count asymmetry, lifted verbatim, flagged rather than fixed.** The founding-administrator count's group arm uses `gm.ends_on is null` with no date window and no membership join, while the giving count is membership-aware. R1 says "lifted verbatim", and a behaviour change would be a separate ruling. A DB test pins the asymmetry as it stands, so a future fix is a visible decision.
- **`users.email` existence check is a sequential scan.** There is no `lower(email)` index, and `users` is `schema.ts`/Drizzle Kit territory: a hand-added index would be dropped by the next `db:push`. Negligible at today's scale (32 users on the branch). A TODO candidate if the user table grows.
- **Dev seed rows dated 2099.** The two live Quillhaven rows and the live Fernwood resend have `created_at` 2099-01-01 and `expires_at` 2099-01-30, so test-rls-59's positive control never expires on a long-lived `development`. The expiry CHECK caps the window at 30 days from `created_at`. **For Batch 2b:** a rolling-24 h limit query should also bound `created_at <= now()`, or it will count these three dev rows forever.

### Deviations from the design (all small; none changes an architect ruling)

1. **One trailing OUT column, `treasurer_role_id uuid`, on `presby_accept_invitation`.** The existing `org.treasurer.designated` metadata carries `roleId`, and `accept.ts` (presby_app, no table access) could not otherwise produce it. For the treasurer purpose, `administration_role_key` is `'treasurer'` and `office_role_key` is null. The signature (the ACL target) is unchanged: OUT columns are not part of it.
2. **`person_mode` values:** `created_person`, `existing_person` and **`linked_person`** (a founding administrator's on-file match, or an unlinked treasurer roster person). TS had only the first two. The internal `existing_person_new_membership` (TS's defensive zero-membership branch) is reported as `existing_person`, as TS did.
3. **A `BEFORE INSERT` guard in addition to the design's update and delete guards.** It enforces that rows are born open (Creation Is Guarded As Strongly As Mutation, F54–F58), that a founding-administrator row has no person at insert, and the D-1 chain check. The addendum allowed either a `BEFORE INSERT` check **or** the Batch 1c test; both are implemented. **For Batch 2b:** `issue.ts` must insert open rows only; must not set `person_id` for `founding_administrator`; must set `resent_from_id` and `resend_count = parent + 1` on a resend; and must supersede before inserting (both partial indexes).
4. **The marker value is `'true'`** (the house idiom: `presby.affiliation_trigger_active`, `giving_write_active`, DECISION-141), not the `'on'` in the Phase 3 text. The guard checks `= 'true'`.
5. **Treasurer, existing account that is already a different person.** Phase 3 did not spell this case. The function refuses before linking (two live people on one account is the F110/F112 state). The reason is `ambiguous_person` if that other person is at this org, else `person_elsewhere`, both from the closed list.
6. **Preview `person_display_name` for a founding administrator** first prefers the matching session's own live person at the org, then the single on-file match, then the invitee names. This mirrors accept step 4(a)/(b).
7. **Existing-account founding administrator who needs a new person:** the names come from `p_first_name`/`p_last_name` if given, else from the invitee names on the row. In new mode, names are required. A blank name or a control character in new mode raises `invalid_parameter_value` (a programmer error: `accept.ts` validates first, G17), as does a bad bcrypt shape.

### Integration instructions (orchestrator, Rule 16; nothing below was edited by Batch 1)

- **`drizzle/meta/_journal.json`:** append `{ "idx": 59, "version": "7", "when": <after 0057's 1787014313186; leave room for 0058, e.g. 1787014373186>, "tag": "0059_presby_account_invitations", "breakpoints": true }`. Per Phase 3, 0058 (Track F mail) may land before or after it, so do not assume contiguity.
- **`src/lib/db/domain/index.ts`:** add `export * from "./invitations";`. Then run the real `npm run check:schema-parity`; the scratch-equivalent result above was 0 failing. Then run **`npm run docs:erd`** (Phase 3 1a). It regenerates `docs/schema-design.md` through the schema barrel, so it can only see the table once the export exists.
- **`scripts/test-rls.sql`:** append one line at the end, after the last section's closing banner: `\ir invitations/test-rls-59.sql`. It needs `scripts/install-test-helpers.sql` (owner) first, as the whole suite does. Re-run the whole suite as presby_app on the merged `development` after the seed is merged.
- **`scripts/seed-dev.sql`:** append the full contents of `scripts/invitations/seed-dev-invitations.sql` at the **end** of the file (it references Quillhaven, Marrowbone and Fernwood, people `c1000000-…-0001/-0002/-0006`, and the elder fixture user `e0000000-…-00f2`). It is idempotent and never touches the e2e orgs. test-rls-59 depends on it.
- **`docs/decisions.md`:**
  - DECISION-184 should name `resent_from_id` (not `superseded_by_id`), the D-2 index, the D-1 unique index, and the `BEFORE INSERT` born-open and chain guard. The addendum's DECISION-183 sentence fix applies as already recorded.
  - DECISION-188 should carry the outcome contract as built: the outcome strings, the `blocked_reason` list, `person_mode` including `linked_person`, the trailing `treasurer_role_id`, the D-5.1 re-arm, and the D-5.2 mapping table.
- **Findings log (`docs/schema-design-2.md`):** F153–F159 as proposed. Batch 1 adds no new F-number; the `FOUND` bug was Batch 1's own pre-merge defect, caught by its own tests.
- **`docs/TODO.md`:** add a line for a possible `lower(users.email)` index if `users` grows (it needs a `schema.ts` change, not a hand migration). The holder-count asymmetry above deserves a line for a future ruling. Add the 2099-dated dev seed rows with the limit-query note for Batch 2b, unless 2b handles it first.
- **`docs/deployment.md` pre-deploy runbook for 0059:** apply **with `-1`** (unlike 0057, the file has no inner transaction): `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0059_presby_account_invitations.sql`. Verify FORCE + one policy; `has_table_privilege('presby_app','account_invitations',…)` is false for all four privileges; presby_app EXECUTE on the two functions only; the seven functions are definer with a pinned search_path. **Do not run** `test-rls-59.sql` or `seed-dev-invitations.sql` on production.

### Handoff to Batch 2 (api-developer)

- **What exists now:** the `account_invitations` table (`src/lib/db/domain/invitations.ts`, imported directly until the integration export) and the seven functions above. `src/lib/testing/invitation-fixture.ts` is ready for the `issue.ts`/`accept.ts` DB tests.
- **Apply locally (pipeline branch only):** `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0059_presby_account_invitations.sql`, then optionally `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/invitations/seed-dev-invitations.sql`. Both are already applied to `pipeline-invitations`.
- **`accept.ts` call:** `select * from presby_accept_invitation($1::text, $2::uuid, $3::text, $4::text, $5::text)` on `db`, inside `db.transaction` with the audit inserts. Outcomes: `dead | account_exists | email_mismatch | account_inactive | blocked | accepted`.
- **`previewInvitation`:** `select * from presby_preview_invitation($1::text, $2::uuid)`, with `$2` from `auth()` only (D-3).
- **`issue.ts` (owner):** the gates are `presby_founding_administrator_holder_count(org)` and `presby_giving_manage_holder_count(org)`. Map `unique_violation` on `account_invitations_open_designation_uq` **or** `account_invitations_open_address_uq` (by constraint name) to `already_pending` (D-2). Note Deviation 3's insert rules.
- **Batch 2d:** when `countFoundingAdministratorHolders`/`countGivingManageHolders` become wrappers over the SQL counts, the "SQL counts equal TS counts" test in `invitations.db.test.ts` becomes tautological. Keep the asymmetry assertions (they pin behaviour), and drop or rename the equality. When deleting the `designate*` transactions, keep each parity scenario's `pin()` golden comparison and remove the TS half (see the parity file header).
- **`test-rls.sql` sections added:** 59 (staged as `scripts/invitations/test-rls-59.sql`, sections (a)–(g)). No existing section touched.
- **Next agent:** api-developer (Batch 2).

---

## Batch 2 — server (api-developer, 2026-10-21)

**Status: Batch 2 complete (2a, 2b, 2c, 2d), working tree uncommitted.** Built on Batch 1 (HEAD 35cbd17). Did not touch any Rule 16 integration-only file (`scripts/test-rls.sql`, `scripts/seed-dev.sql`, `drizzle/meta/_journal.json`, `src/lib/db/domain/index.ts`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`). No commit made. No schema change (0059 untouched). Suggested commits: `feat(invitations): token, email, queue redaction and the issue side` (2a+2b), `feat(invitations): accept side, (invite) actions and the admin invitation actions` (2c), `refactor(invitations): retire the TypeScript designation transactions` (2d, after the parity-green run recorded below), each with `Work-Log: 2026-10-21-invitations`.

### Files Created

- `src/lib/onboarding/invitation-token.ts` (+ test): `mintInvitationToken()`, `hashInvitationToken()`, `isWellFormedInvitationToken()` (`^[A-Za-z0-9_-]{43}$`). Pure `node:crypto`; also the e2e fixture seam (Batch 4).
- `src/lib/onboarding/invitation-email.ts` (+ test): `renderInvitationEmail()` (the ONLY place the message is built), `ACCOUNT_INVITATION_TEMPLATE_KEY`. Link is `${platformOrigin()}/invite?token=<token>` and nothing else; returns `null` when there is no safe origin. The accept URL is one unchanged substring in the html (href and printed copy) and in the text. Names `escapeHtml`'d, control characters stripped, capped at 100; no sender free text; the invited address is never in the body.
- `src/lib/onboarding/input.ts` (+ test): G17 boundaries shared by `issue.ts` and `accept.ts` (email trim/lowercase/shape, NFC + control-strip names 1-100, password 8 characters min and **72 UTF-8 bytes** max, `UUID_RE`).
- `src/lib/onboarding/status.ts`, `labels.ts` (+ test): `deriveInvitationStatus()`, `deliveryState()`, status and delivery vocabulary, operator and invitee copy per blocked reason, the dead-link and rate-limit literals. Pure, client-safe.
- `src/lib/onboarding/issue.ts` (+ `issue.db.test.ts`): the issue side, **`getPlatformDb()` only** (below).
- `src/lib/onboarding/accept.ts` (+ `accept.db.test.ts`): the accept side, **`db` (presby_app) only** (below).
- `src/lib/onboarding/invite-cookie.ts`: `INVITE_TOKEN_COOKIE = "invite_token"`, `inviteCookieOptions()` (httpOnly, `Secure` in production, `SameSite=Lax`, `Path=/invite`, `Max-Age=1800`). Shared with the Batch 3 page, which reads the cookie when the query has no token.
- `src/app/(invite)/actions.ts` (+ test): the five public actions. No `layout.tsx`, no `loading.tsx`, no pages (Batch 3).
- `src/lib/email/credential-keys.ts`: `CREDENTIAL_TEMPLATE_KEYS`, `REDACTED_BODY_MARKER`, `isCredentialTemplateKey()`, dependency-free so the Retry action and the email-queue page can import it without `@/lib/db` (queue.ts re-exports them).
- `src/lib/email/queue-credential.test.ts`, `src/lib/onboarding/boundaries.test.ts` (S4 and D-3 source scans), `src/lib/onboarding/invite-headers.test.ts`.

### Files Modified

- `src/lib/audit.ts` (+ `audit.test.ts` catalog pin): six keys appended in one block (below).
- `src/lib/email/queue.ts`, `src/lib/email/index.ts`: `insertQueueRowInTx(tx, input)`, `attemptQueuedSend(id)`, `cancelQueuedEmail(tx, id)`; `enqueueEmail()` is now their composition (behaviour preserved; `queue.test.ts` and `api/cron/email-queue/route.test.ts` untouched and green). Redaction of credential bodies in the same UPDATE that sets `sent` (inline and worker) or `failed` (worker permanent failure). Barrel re-exports.
- `src/app/(admin)/admin/organizations/[id]/actions.ts` (+ `actions.test.ts`): `designateFoundingAdministratorAction` and `designateTreasurerAction` **replaced** by the five invitation actions; every `no_such_user` string and the "ask them to sign up first" copy is gone (C5).
- `src/app/(admin)/admin/organizations/[id]/founding-administrator-section.tsx`, `treasurer-designation-section.tsx` (+ both tests): **minimal rewire only, forced by the deletion** (they imported the deleted actions): call the new actions, founding administrator gains first and last name inputs, "sign up first" and "must have a platform account" hints removed, button copy "Send invitation". Everything else in them (pending rows, resend/revoke, confirm sentences for self-address and local-login-off, `HydrationGate` on the founding-administrator form) is Batch 3's.
- `src/app/(admin)/admin/email-queue/actions.ts` (+ test): **F158**, `retryEmailAction` refuses a `failed` row whose `templateKey` is in `CREDENTIAL_TEMPLATE_KEYS`. `page.tsx`: `cancelled` joins the status filter/strip/badges; a failed credential row shows "can't be retried, use Resend" instead of the Retry button.
- `src/proxy.ts` (+ `proxy.test.ts`): `PUBLIC_PATHS` gains exactly `"/invite"` and `"/invite/accepted"`.
- `next.config.ts` (+ `src/lib/giving/csp.test.ts`, whose exact header-source list pin gained the two entries): `/invite` and `/invite/accepted` get `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, scoped with `has: host PLATFORM_HOST`, placed after the catch-all so they win.
- `src/lib/onboarding/founding-administrator.ts`, `treasurer-designation.ts` (+ tests): the TypeScript designation transactions, `deriveNameFromUser()` and the result types are **deleted** (2d). What remains: `foundingAdministratorPlan()`, `TREASURER_DESIGNATION_ORG_TYPES`, `treasurerDesignationApplies()`, and `countFoundingAdministratorHolders()` / `countGivingManageHolders()` as thin wrappers over the two owner-only SQL count functions (same exported signatures; `page.tsx` unchanged). Neither module has a runtime `@/lib/db` import any more.
- `src/lib/onboarding/designation-parity.db.test.ts`: the TypeScript half of each scenario removed; every scenario now runs the real acceptance and asserts SQL == the committed golden (`designation-parity.golden.json`, **not regenerated**).
- `src/lib/db/domain/invitations.db.test.ts`: one test retitled (the SQL-vs-TS count equality is tautological now; the asymmetry assertions are kept). `src/lib/testing/invitation-fixture.ts`: `insertInvitation` takes `emailQueueId`.

### Contract for Batch 3 (ux-developer) and Batch 4

**Admin server actions** (`src/app/(admin)/admin/organizations/[id]/actions.ts`; each: `auth()` then `hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)`, `Unauthorized.` / `Forbidden.` otherwise; ids by `UUID_RE`; `revalidatePath` on success only):

| Action | FormData | Result |
|---|---|---|
| `inviteFoundingAdministratorAction(fd)` | `organizationId`, `email`, `firstName`, `lastName`, optional `acknowledge` (`"true"`/`"on"`) | `InvitationActionResult` |
| `inviteTreasurerAction(fd)` | `organizationId`, `email`, optional `acknowledge` | `InvitationActionResult` |
| `resendInvitationAction(fd)` | `organizationId`, `invitationId` (must belong to that org) | `InvitationActionResult` |
| `revokeInvitationAction(fd)` | `organizationId`, `invitationId` | `InvitationActionResult` (`{ ok: true, invitationId }`) |
| `revokeAllInvitationsAction(fd)` | `organizationId` | `InvitationActionResult` (`{ ok: true }`) |

`type InvitationActionResult = { ok: true; invitationId?: string; expiresAt?: string /* ISO */; delivery?: 'sent' | 'queued'; selfAddressed?: boolean } | { ok: false; error: string; needsAcknowledgement?: 'do_not_contact' }`. The UI composes the success copy from `delivery`/`expiresAt`/`selfAddressed` ("Invitation sent to x. It expires on [date]. Nobody holds this role until it is accepted."; `queued` is "Invitation created. Email delivery is delayed; we'll keep trying."). When `needsAcknowledgement` is present, show the `error` text with a confirm and re-submit with `acknowledge=true`. Error strings are final operator copy and never mention account existence.

**List read for the org page** (server only, `src/lib/onboarding/issue.ts`): `listInvitationsForOrg(organizationId): Promise<InvitationListRow[]>` with `{ id, purpose, email, inviteeFirstName, inviteeLastName, personId, status: 'pending'|'accepted'|'expired'|'revoked'|'blocked', delivery: 'queued'|'sent'|'delivered'|'bounced'|'failed'|'cancelled'|'unknown', createdAt, expiresAt, acceptedAt, selfDesignated, blockedReason, resendCount, canResendAt }`; superseded rows are excluded. Labels and per-reason operator copy: `src/lib/onboarding/labels.ts` (`INVITATION_STATUS_LABEL`, `DELIVERY_STATE_LABEL`, `BLOCKED_REASON_OPERATOR_COPY`); both client-safe. `issue.ts` is imported only from `(admin)` (source scan) and is `server-only`.

**Public actions** (`src/app/(invite)/actions.ts`, no `FEATURES` key: the token is the credential). All state-returning actions have the `useActionState` shape `(prev: AcceptFormState, formData) => Promise<AcceptFormState>`; **this differs from Phase 3's `acceptSignedInAction(formData)` signature on purpose**, so the signed-in Accept form can show an inline `role="alert"` error:

| Action | Fields | Behaviour |
|---|---|---|
| `acceptNewAccountAction(prev, fd)` | `token`, `firstName`, `lastName`, `password`, `confirm` | IP-keyed `checkRateLimit("invite_accept:<ip>", 10/hour)` first; refuses if a session exists; confirm mismatch; refuses while `auth.local_login` is off; on success clears the cookie and `redirect("/invite/accepted")` |
| `acceptSignedInAction(prev, fd)` | `token` | rate limit; `auth()` required; **G9**: refuses `twoFactorRequired && !twoFactorVerified`; identity ONLY from `session.user.id`; on success clears the cookie and `redirect("/launch?next=%2Fo%2F<slug>")` (slug from the function's row) |
| `startSignInToAcceptAction(fd)` | `token` | sets the `invite_token` cookie, `redirect("/signin?callbackUrl=%2Finvite")` (no token in a URL) |
| `continueToVerifyAction(fd)` | `token` | cookie, `redirect("/totp?callbackUrl=%2Finvite")` |
| `switchAccountAction(fd)` | `token` | cookie, `signOutAction("/invite")` |

`type AcceptFormState = { status: 'idle' } | { status: 'error'; code: AcceptErrorCode; message: string; field?: 'firstName'|'lastName'|'password'|'confirm' }`, with `AcceptErrorCode` = `rate_limited | signed_in | not_signed_in | two_factor_required | local_login_disabled | dead | account_exists | email_mismatch | account_inactive | blocked | invalid_input | password_mismatch | db_error`. `message` is ready to render (dead link is `INVITATION_DEAD_LINK_COPY`; blocked reasons are `INVITEE_BLOCKED_COPY[reason]`). A malformed token is the dead bucket without a round trip.

**For the Batch 3 page** (`src/app/(invite)/invite/page.tsx`): `previewInvitation(token, session?.user?.id)` from `@/lib/onboarding/accept` returns `InvitationPreview | null` (`organizationName, organizationType, purpose, inviteeFirstName, inviteeLastName, personDisplayName, maskedEmail, expiresAt, sessionMatches: boolean | null`); null is the dead-link state. **The second argument MUST be the `auth()` session id** (a source scan, `boundaries.test.ts`, fails otherwise; it also fails if the page imports `getPlatformDb`, `issue.ts` or any `@/lib/db*` module, or if `(invite)` gains a `layout.tsx`/`loading.tsx`). Token source: query `token`, else the `invite_token` cookie (`INVITE_TOKEN_COOKIE`). Render states by `preview`, `session`, `sessionMatches`, `session.user.twoFactorRequired/Verified`, `isLocalLoginEnabled()`. The hidden `token` field of the forms carries the token.

### Server library contracts

- **`createInvitation(input)`** returns `ok { invitationId, expiresAt, delivery, selfAddressed } | has_holders | already_pending { invitationId | null, expired } | not_applicable | provisioning_incomplete | no_matching_person | ambiguous_person | membership_ended | needs_acknowledgement { reason: 'do_not_contact' } | totp_unavailable | link_origin_unavailable | invalid_input { field } | rate_limited | db_error`. One transaction under the organization-row lock: org, applicability (treasurer allow-list), holder gate (owner-only SQL count), baseline provisioning pre-check (derived group; both role templates for a treasurer), **treasurer person first (C6)**, `isTotpConfigured()`, do-not-contact, one open designation, durable limits, render, queue row (`insertQueueRowInTx`), invitation row with `email_queue_id` set at insert, `invitation.created` audit row; the provider call is AFTER the commit and a failure leaves the row `queued` (`delivery: 'queued'`). **It reads no `users` row** (source-scanned).
- **`resendInvitation`** (supersede FIRST, then insert the successor with `resent_from_id` and `resend_count + 1`, cancel+scrub the old queued email, audit): `ok | not_found | not_open | has_holders | link_origin_unavailable | rate_limited | db_error`. **`revokeInvitation`**: `ok | not_found | not_open | db_error`. **`revokeAllOpenInvitations`**: `ok { revoked } | db_error`.
- **Durable limits** (one constants block, `INVITATION_LIMITS`): 20 per inviter, 10 per organization, 3 per recipient address, each per rolling 24 h over every row including superseded/revoked and bounded **above** by `now()` (the 2099 dev-seed rows never count); resend cooldown 5 minutes; 5 resends per chain; default expiry 7 days. One refusal literal for every cause. A resend counts as an email against the per-inviter/org/address limits.
- **`acceptInvitation({ token, mode })`**: validation (G17) and bcrypt (cost 10, once per new-account submission whether the token is live, dead or malformed) before the token is looked up; then one `db.transaction` containing `presby_accept_invitation(...)` and the audit rows. Results: `accepted { mode, organizationSlug } | dead | account_exists | email_mismatch | account_inactive | blocked { reason } | invalid_input { field } | db_error`.

### Audit Events

All inserted with `insertAuditRow(tx, ...)` in the mutation's own transaction (never `recordAudit()`); ids only. Six keys appended to `AUDIT_ACTIONS` in one block: `invitation.created`, `invitation.resent`, `invitation.revoked`, `invitation.accepted`, `invitation.accept_blocked`, `user.created_via_invitation`.

| Outcome | Rows | Actor |
|---|---|---|
| created | `invitation.created` | operator |
| resent | `invitation.resent` | operator |
| revoked (single) / revoked-all | `invitation.revoked` (`via: single` / `revoke_all`), one per row | operator |
| accepted, new account | `invitation.accepted`, `user.created_via_invitation`, `org.founding_administrator.designated` or `org.treasurer.designated` (with `viaInvitationId`, `invitedByUserId`, `inviterIsInvitee`) | the new user (email null: the full address never reaches this code) |
| accepted, existing account | `invitation.accepted`, the designation row | the accepting user (email from the session) |
| blocked | one `invitation.accept_blocked` (`reason`) per reason | the account when known (existing mode), else null |
| dead, `account_exists`, `email_mismatch`, `account_inactive`, validation failures | none (nothing to attribute) | n/a |

`check:audit` has nothing to see in the new `actions.ts` files (no `db.*` call, no `recordAudit()` there by design), so Rule 7 is proven the DECISION-179 way, by the per-outcome DB tests below.

### Tests

**Pure/unit (always run):** `invitation-token` 4, `invitation-email` 11, `input` 17, `status`+`labels` 6, `queue-credential` 11, `(invite)/actions` 34, `boundaries` 9, `invite-headers` 4, admin `actions.test.ts` 119 (rewritten around `issue.ts`), both section tests, `email-queue/actions` +2 (F158), `proxy` +2, `csp` pin updated, `audit` catalog pin. Whole suite: **474 files passed, 6996 tests passed, 2018 skipped (DB-gated)**.

**DB-backed, one file per process against `pipeline-invitations` (`--no-file-parallelism`):**

| File | Tests | Result |
|---|---|---|
| `src/lib/onboarding/issue.db.test.ts` | 50 | 50 pass |
| `src/lib/onboarding/accept.db.test.ts` | 30 | 30 pass |
| `src/lib/db/domain/invitations.db.test.ts` (Batch 1, rerun) | 66 | 66 pass (one 20 s Neon stall on the first run, passes alone) |
| `src/lib/onboarding/designation-parity.db.test.ts` | 12 | 12 pass, **both before (SQL == TS and SQL == golden) and after the deletion (SQL == golden)** |
| `src/lib/onboarding/founding-administrator.test.ts` | 17 | pass |
| `src/lib/onboarding/treasurer-designation.test.ts` | 11 | pass |

`issue.db.test.ts`, one test per outcome: created (founding administrator delivered; provider failing so the row stays `queued` with a working link whose token hashes to the stored `token_hash` and previews through the real function, then **a later `processQueueBatch(1)` success redacts it**; treasurer), the identical result and queue shape for an address with and without an account, self-addressed, a **failed audit insert rolling back** create / resend / revoke / revoke-all, every refusal (`has_holders` x2, `already_pending` x2 incl. expired, `not_applicable`, `provisioning_incomplete`, `no_matching_person` incl. another org's person, `ambiguous_person`, `membership_ended`, `needs_acknowledgement` then ok-acknowledged, `totp_unavailable`, `link_origin_unavailable`, `invalid_input`), the three durable limits plus the **2099-dated rows never counted** regression, the real unique-violation error shape by constraint name and **a real race through a test-only trigger on both create (`already_pending`) and resend (`not_open`)**, resend (lineage, old email cancelled and scrubbed, old link dead, new link live, expired-open resendable, cooldown, chain cap, address limit, not_open x3, not_found x3, `has_holders`, `link_origin_unavailable`), revoke (queue cancelled/scrubbed, sent left sent, cross-org `not_found`), revoke-all (only this org, one audit row each), list, and source scans (no `users` read, no `recordAudit`, platform connection only).

`accept.db.test.ts`: accepted x {new, existing} x {founding administrator, treasurer} with the exact audit rows and metadata, the bcrypt hash verified against the password, ids only (no address, token, hash or password anywhere in audit), self-designation `inviterIsInvitee` on both rows, single use; failed audit insert rolls back an acceptance and a **committed `blocked_at`**; **each of the eight blocked reasons** writes exactly one `invitation.accept_blocked`, commits `blocked_at`, writes nothing else and kills the link; `account_exists`, `email_mismatch`, `account_inactive`, and every dead state write no audit row and leave the token alive where it should; validation before the DB incl. the UTF-8 byte limit and "not a token oracle"; bcrypt runs exactly once for live, dead and malformed tokens; preview (masked, `session_matches`, null for every dead state and for the stored hash).

**Failing-first proofs (Batch 2):** with `redactionFor()` disabled, 4 unit tests and the DB test "delivered -> sent, body redacted" fail; restored, green (the mutation was reverted before anything else ran). The Batch 1 proofs stand.

### Gate Results (api-developer, 2026-10-21)

- `npm run typecheck`: pass. `npm run lint` (`--max-warnings=0`): pass. `npm run check` (all eight tripwires, `check:audit` and `check:proxy-imports` included): pass.
- `check:secrets` scans tracked files only; I ran its exported `checkSecretsPii()` over every untracked and modified file (43): 0 findings.
- Row counts after all DB suites equal the pre-batch baseline (users 32, people 763, memberships 125, role_grants 94, app_roles 102, invitations 6 = the staged seed); no `Fixture ... for inv-*` org leaked; the test-only triggers/functions created by the suites are dropped (verified in the catalog).
- Flakes (Neon, not regressions): the first full `issue.db` run lost two tests to `Connection terminated unexpectedly` (they pass on re-run, and the 50/50 run is recorded above); `invitations.db` had one 20 s timeout on a single test, which passes alone.

### Deviations and judgement calls (all small; none changes an architect ruling)

1. **`acceptSignedInAction` is `(prev, formData)` returning `AcceptFormState`**, not `(formData)` as in Phase 3, so the form can render the refusal inline.
2. **Cancelling a queued invitation email also scrubs its body** (`cancelQueuedEmail` redacts credential keys in the same UPDATE). Phase 3 said only "cancel"; a cancelled row still held a link, so this is strictly tighter.
3. **`createInvitation` returns `invalid_input { field: 'organizationId' }` for an organization that does not exist** (Phase 3's result union had no `not_found`), and **`already_pending.invitationId` is `string | null`** (null only when the race-rolled-back rival no longer exists to name).
4. **`resendInvitation` also re-checks the holder gate** (`has_holders`) and applies the per-inviter/org/address limits (a resend is an email); Phase 3 listed only the cooldown and the chain cap. **A unique violation during resend maps to `not_open`.**
5. **The two section components were rewired** (minimum edit, forced by the deletion); see Files Modified. Phase 3 assigned their redesign to Batch 3, which still owns it.
6. **`email_queue` bodies of a `failed` credential row are redacted too** (Phase 3 listed `sent` and `failed`; this is just recorded because the Retry refusal depends on it).
7. **The "four resolver files unchanged" mechanical test is not re-added**: it was retired in F131 because a byte-identical-to-main pin only means something inside its own pipeline. `boundaries.test.ts`/`founding-administrator.test.ts` pin the durable form instead: no `src/lib/onboarding` module imports a resolver-side file.
8. **Actor email on `invitation.accepted` (new account) is null**: the full invited address never reaches application code on the anonymous path (DECISION-153), so the audit row carries `actor_user_id` only; existing-account rows carry the session's email.

### Notes for Batch 3, Batch 4 and integration

- **Batch 3:** the founding-administrator form still lacks the Phase 3 confirm sentences (self-address via `selfAddressed`, local-login-off warning) and `HydrationGate`; the page does not read or render `listInvitationsForOrg` yet; `isLocalLoginEnabled()`/`isTotpConfigured()` page props are not wired. A pending invitation does not yet replace the form (the server refuses a second one with `already_pending` and the message names Resend/Revoke, which the UI does not offer until Batch 3). `(invite)/invite/page.tsx` and `invite/accepted/page.tsx` do not exist; `RESERVED_SLUGS`'s `invite` pin is by name until they do.
- **Batch 4:** `e2e/admin-organizations.spec.ts` Test 7 (treasurer) asserts the old button/dialog copy and "designating a member makes the control disappear"; it needs the rewrite in Phase 3's blast-radius section (and a throwaway org with an on-file email, F159). `e2e/support/invitation-fixture.ts` should reuse `invitation-token.ts` (`mintInvitationToken()`/`hashInvitationToken()`).
- **Integration (orchestrator):** the doc edits and shared-file edits already listed in Batch 1 and Phase 3 stand. **New TODO lines** for the TODO aggregator: scrub `password_reset`, `email_change_verify`, `statistics_submission_grant` bodies (F154: add the key to `credential-keys.ts`, one edit also makes Retry refuse it); the hand-off cookie is not cleared on a dead link (D-6); the founding-administrator holder-count asymmetry (ruling: keep, per the orchestrator); `INVITATION_LIMITS` are constants in `issue.ts` (no per-environment override). The `next.config.ts` `/invite` header rules must be re-checked against the parallel review-polish pipeline's header work. When `renderEmail()`/`RenderedEmail` from review-polish merges, adapt `invitation-email.ts` (the one place) and `insertQueueRowInTx`'s caller; `queue.ts`'s new functions are starter-generic (S9, stage for `/downstream-sync`).
- **Next agent:** ux-developer (Batch 3).

## Batch 3 — UI (ux-developer, 2026-10-21)

**Status: Batch 3 complete, working tree uncommitted.** No schema, server-library or Rule 16 shared-file change. Suggested commits: `feat(invitations): the /invite pages and accept forms` and `feat(invitations): invitation panels in the organization designation sections`, each with `Work-Log: 2026-10-21-invitations`.

### Files Created
- `src/app/(invite)/invite/`: `page.tsx` (Server Component, one state, `previewInvitation(token, session?.user?.id)`, token from query else cookie, DB failure is its own "can't load, your link is still good" state), `invite-shell.tsx`, `invite-summary.tsx`, `dead-link-state.tsx`, `anonymous-state.tsx`, `mismatch-state.tsx`, `two-factor-state.tsx`, `confirm-state.tsx`, `unavailable-state.tsx`, `sign-in-to-accept-form.tsx` (server-action form), `accept-form.tsx` and `accept-signed-in-form.tsx` (client, `useActionState`), `recheck-once.tsx` (see finding below), `accepted/page.tsx` (static). Tests beside each.
- `src/components/shared/submit-button.tsx` (`useFormStatus` pending button for plain server-action forms).
- `src/app/(admin)/admin/organizations/[id]/`: `invitation-list.tsx` (rows, status icon + word, delivery, Self-designated badge, blocked-reason copy, Resend, Revoke behind AlertDialog), `revoke-all-invitations.tsx`, `send-invitation-dialog.tsx`, `use-send-invitation.ts`, `invitation-sent-notice.tsx`, `invitation-row.fixture.ts` (test support), tests for list and revoke-all.

### Files Modified
- `founding-administrator-section.tsx`, `treasurer-designation-section.tsx` (+ tests): replace Batch 2's minimal rewire. Three states: read-only holders line (plus history), open invitation (row with Resend/Revoke replaces the form), form. Confirm dialog gains the self-address sentence, the password-sign-in-off sentence, and the do-not-contact "Send anyway" step (re-submits `acknowledge=true`). Send disabled with an alert when `isTotpConfigured()` is false. Palette literals removed from both sections (tokens only). `HydrationGate` on both forms.
- `page.tsx` (+ test): reads `listInvitationsForOrg` (a failed read renders an alert, never an empty list), `isLocalLoginEnabled()`, `isTotpConfigured()`, the operator's email; hands each section its purpose's rows; renders Revoke-all only when at least one invitation is open.
- `src/app/no-organization/page.tsx` (+ new test): S7 sentence.

### Contract notes
- `acceptSignedInAction` is `(prev, formData)`, as Batch 2 recorded. A blocked or dead result removes the submit button (the token is spent); a retryable error keeps it.
- The create form is controlled state under `HydrationGate` (not `useForm`), so a refused submit does not wipe entries; focus goes to the offending field, else the `role="alert"`.
- Treasurer name fields are prefilled by splitting the roster display name (editable); founding administrator names come from the invitation.
- No new copy beyond what is in the components; strings a fork should review: the `/invite` summary and role sentences (`invite-summary.tsx`), `DeadLinkState`, `UnavailableState`, `/invite/accepted`, the dialog sentences (`send-invitation-dialog.tsx`), the open-invitation and TOTP-unconfigured lines in both sections.

### FINDING (fixed in this batch, for the architect): R6's `Path=/invite` cookie vs server-action redirects
Browser pass: after "Sign in to accept" and a correct sign-in, the invitee landed on "This link isn't active" until a reload. Cause: `signInWithCredentials` (and the `/totp` verify action) finish with `redirect("/invite")`, and Next renders that redirect target inside the action's own POST to `/signin` or `/totp`; the browser does not send a `Path=/invite` cookie to those paths, so the prerendered `/invite` has no token and the client paints it. A reload fixes it. Mitigation (UI only, R6 untouched): the no-token render mounts `RecheckOnce`, which calls `router.refresh()` once (a real browser request that carries the cookie); a token that is present never re-requests; markup of the dead page is unchanged. Verified: sign in returns to the right state within about a second (a brief dead-link flash before the refresh). The cleaner fix is a cookie `Path=/` (or a different hand-off), which is the architect's call; flagged, not done.

### Tests (all mine; Batch 3 added about 70)
Page: one state per (token, session, preview) including dead-link markup parity, cookie fallback, query-wins, both doors anonymous (S1), local-login-off, mismatch outranks 2FA, 2FA gate, confirm, DB blip not dead. Forms: labels, rules before password, autocomplete, toggle, inline alert + focus + entries kept, finished states, no native dialogs. Sections: every state and sentence above. List and revoke-all: statuses, badge, Resend, Revoke dialog, results announced. Org page: purpose split, revoke-all gating, failed-read alert. Full run: typecheck, lint, `npm run check` (eight tripwires, hydration gate included) pass; vitest 482 files / 7067 tests pass (2018 DB-gated skipped); `boundaries.test.ts` (session-id second argument, no db import, no layout/loading) passes.

### Browser verification (dev server on 3500 from this worktree, stopped afterwards; Playwright chromium at 360x740 and 1280x800; screenshots in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/6e3e960d-cf0c-43df-b4c9-d41f1a6a4811/scratchpad/invites/`)
- No horizontal overflow on any page at 360 (scrollWidth 360); every control 44px tall.
- `/invite`: dead page byte-identical for unknown, expired, revoked, superseded and no token; live link survives two reloads; create form (short password: inline alert, focus on password, entries kept; mismatch focuses confirm; show/hide toggle); treasurer variant; "Sign in to accept" sets an httpOnly, `Path=/invite`, SameSite=Lax cookie with no token in the URL, signs in and returns to the right state (after the fix), "Sign out to accept" returns to create-account; signed in as another account (masked address, sign out); 2FA-required account (verify button goes to `/totp?callbackUrl=/invite`); confirm state ("Accepting as ... at ...") and an Accept that came back blocked (`has_holders`) inline with no button left. `/invite/accepted` static. Response headers `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` (Cache-Control is overridden by the dev server).
- Not exercised in a browser: a successful create-account or successful signed-in Accept (they grant real authority; Batch 4's throwaway-org e2e owns them) and the full TOTP challenge round trip.
- Admin (`/admin/organizations/<id>`): two open invitations with Revoke-all (Quillhaven), history (Fernwood), expired (Marrowbone), holders plus history (Alder Creek), pending row replacing the form, Resend result, Revoke dialog, self-address confirm sentence, send, treasurer roster refusal ("Nobody enrolled ..."), Revoke-all dialog, form returns.
- Branch data left behind on `pipeline-invitations` by this pass: two extra dev invitations (Alder Creek and Bramblewood, now blocked or revoked, addresses `*.invalid`), a few resend/send rows on Bramblewood (all revoked) and their `email_queue` rows. The seeded rows were not touched, so `test-rls-59.sql` is unaffected.

### Notes for Batch 4
Selectors: `data-testid` `founding-administrator-section`, `treasurer-designation-section`, `invitation-row`, `revoke-all-invitations`, `self-address-sentence`, `local-login-off-sentence`; accept form ids `invite-first-name`, `invite-last-name`, `invite-password`, `invite-confirm`, error `#invite-error`. The post-sign-in return to `/invite` repaints after a refresh, so specs should wait for the heading rather than the URL. Existing e2e Test 7 still needs its Phase 3 rewrite.

---

## Batch 4 — end-to-end, and the addendum-2 cookie fix (full-stack-developer, 2026-10-21)

**Status: Batch 4 complete, Phase 4 complete, working tree uncommitted.** Phase 3 split Batch 4 between api-developer (fixture and the two auth specs) and ux-developer (admin spec rewrite and 360 px); the orchestrator assigned it to one agent as a single coupled batch (the fixture, both auth specs, the admin spec and the cookie fix all hinge on the same seeded-token seam and the same throwaway-org teardown). No schema change, no Rule 16 shared-file edit (`docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `scripts/*`, `drizzle/meta/_journal.json`, `domain/index.ts` untouched). Suggested commits: `test(invitations): observer e2e for the hand-off cookie (fails before the fix)` is NOT possible as a separate green commit (the observer spec is red until the fix), so: `fix(invitations): hand-off cookie Path=/ and __Host- name, remove RecheckOnce` (cookie fix + its unit tests; trailers `Caught-By: automated-test`, `Discovered-In: Phase-4`) and `test(invitations): Batch 4 e2e (fixture, new/existing-account specs, admin send half)` plus `fix(invitations): refresh the session after a signed-in accept` (F167), each with `Work-Log: 2026-10-21-invitations`.

### 1. The addendum-2 fix (Phase 2 addendum 2 ruling, binding; implemented exactly)

**Order of work, as instructed: the observer e2e was written first and run against the unfixed code.**

- **Fail-before** (code at HEAD 9e72e7c, `RecheckOnce` present, `Path=/invite`; dev server on 3500; log `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/6e3e960d-cf0c-43df-b4c9-d41f1a6a4811/scratchpad/run-fail-before.log`): `e2e/invitation-existing-account.spec.ts`, 2 failed (Case A, Case B), 1 passed (the mismatch case). **Each failing case failed the same three bug-catching assertions**: (1) `no dead-link heading on arrival at /invite, with no reload` — expected 0, received 1; (2) `the dead-link heading was never painted on the way back` (the MutationObserver flag) — expected false, received true; (3) the cookie's `path` — expected `"/"`, received `"/invite"`. Everything else in both cases (the preview, sign-in, the real `/totp` challenge, Accept, the persisted rows, the audit rows, token off the wire) was already passing: the defect is the flash and the path, nothing more. (Case A's recorded run also shows a fourth failure, the spec's own over-strict "ids only" assertion that wrongly scanned `actor_email`, the actor's own address from their session; that was a spec bug, corrected before the pass-after run, and is unrelated to the cookie.)
  - *A first fail-before run used a retrying `toHaveCount(0)` for assertion (1); it passed, because the refresh repaired the page inside the assertion's retry window. That is exactly why the observer exists. Assertion (1) is now an immediate `await locator.count()` (the addendum's "immediately on arrival, with no reload"), and the first soft failure above is the immediate one.*
- **Pass-after** (same spec, after the fix; `run-pass-after.log`): 3 passed, then with the treasurer case 4 passed (`run-pass-after3.log`). The three assertions hold in both cases.
- **The fix.**
  - `src/lib/onboarding/invite-cookie.ts`: `inviteCookieOptions()` returns `path: "/"`, never a `domain`; `inviteTokenCookieName(env)` returns `__Host-invite_token` in production and `invite_token` elsewhere (replaces the bare `INVITE_TOKEN_COOKIE`); `INVITE_PAGE_PATH = "/invite"` for every redirect (replaces the conflated `INVITE_COOKIE_PATH`). The header comment states why `Path=/` (a server-action redirect renders its target inside the action's own POST) and why `__Host-`.
  - `src/app/(invite)/actions.ts`: cookie set and cleared through `inviteTokenCookieName()`; every redirect through `INVITE_PAGE_PATH`; `clearHandoffCookie()` still spreads `inviteCookieOptions()`, so the clear uses the same name and path.
  - `src/app/(invite)/invite/page.tsx`: reads `inviteTokenCookieName()`; the empty-token special case is gone (an empty token falls into the one `!isWellFormedInvitationToken` dead-link render, byte-identical to every other dead state again).
  - **Deleted** `src/app/(invite)/invite/recheck-once.tsx`; `DeadLinkState` lost the `recheck` prop and its `role="status"` flash no longer announces to a correctly signed-in invitee.
  - Comments: `src/proxy.ts` (the `PUBLIC_PATHS` note now says host-only `Path=/`, `/` because a server-action redirect renders inside the action's own POST, and that the proxy never reads the cookie; the code is unchanged) and `src/proxy.test.ts` (one comment).
- **Unit tests** (all new or amended; all green):
  - `src/lib/onboarding/invite-cookie.test.ts` (new, 6): `path: "/"` for both environments — regression for the dead-link flash (`Path=/invite`); no `domain` key ever; httpOnly / Lax / 1800 / Secure only in production; the name per environment; the `__Host-` name only ever paired with options the prefix accepts; `INVITE_PAGE_PATH` is not the cookie path.
  - `src/app/(invite)/actions.test.ts`: options now `path: "/"` with no `domain`; a production test that the set and the clear both use `__Host-invite_token` with `Secure`, `Path=/`; the three F167 tests below.
  - `src/app/(invite)/invite/page.test.tsx`: the old "re-asks the browser once" test replaced by "an empty token is the plain dead-link markup, byte-identical to a dead token, with no client refresh component (regression for the dead-link flash)" (empty, malformed and null-preview renders identical, no `<script`); a new test that the page reads `invite_token` outside production and `__Host-invite_token` in production.
  - `src/lib/onboarding/boundaries.test.ts` (+4): the cookie name (literals and `inviteTokenCookieName`) is referenced only in `invite-cookie.ts`, `(invite)/actions.ts` and `(invite)/invite/page.tsx` (comments excluded); the literals live in `invite-cookie.ts` alone; the proxy never names or imports it; no other module imports the cookie module.

### 2. New e2e support (`e2e/support/`) and specs

**Files created:** `e2e/support/invitation-fixture.ts`, `invitation-observer.ts`, `invitation-ui.ts`; `e2e/invitation-existing-account.spec.ts`, `e2e/invitation-new-account.spec.ts`, `e2e/invitation-fixture-sweep.spec.ts`; `src/lib/onboarding/invite-cookie.test.ts`. **Modified:** `e2e/admin-organizations.spec.ts` (Test 7 rewritten, Test 8 added), `e2e/support/global-setup.ts` (stale-fixture sweep), and the cookie-fix files above.

- **`invitation-fixture.ts`** (DECISION-157 assert-and-throw guards: slug `^e2e-invite-\d+$`, `.invalid` addresses, user deletion only by this run's `e2e-invite-<stamp>-` prefix, a confirming SELECT after teardown). `setupInviteOrg()` (throwaway congregation, `deletable_until`, derived Active Membership group; sweeps stale fixtures first unless `sweep:false`), `addRosterPerson()` (person + `contact_methods` email + active membership: the F159 treasurer), `createThrowawayUser()` (password account, no 2FA, the "existing account, no MFA" invitee), `seedInvitation()` (an OPEN row with a KNOWN token through `invitation-token.ts`, the one src import, pure `node:crypto`), readers (`invitationRow`, `auditRowsFor`, `grantedRoleKeys`, `personAtOrgFor`), `removeInviteOrg()` / `sweepStaleInvitationFixtures()`. Teardown order: delete the invitation e-mails the org's invitations point at (`email_queue_id` has no FK), cascade-delete the org with the roster trigger disabled and re-enabled under retry, stamp-and-delete the people (acceptance creates people as production code; `deletable_until` set at teardown, the documented exception), delete the prefixed users, then confirm nothing survived and neither `admin` nor `mfa-enrolled` holds a membership. **Audit rows cannot be removed (append-only): a run's `invitation.*` rows stay; specs find theirs by invitation id.**
- **`global-setup.ts`** sweeps stale `e2e-invite-*` orgs and users before any session is acquired (an acceptance addressed to the permanent `mfa-enrolled` user gives it a membership at the throwaway org; a lost teardown would move its landing for every later spec — the failure the custom-domains UI fixture met). `invitation-fixture-sweep.spec.ts` proves the net: it simulates the crashed run (an invitation accepted into a throwaway org for `mfa-enrolled`, teardown never called), sweeps, and asserts the org, invitation, throwaway user, membership and person are gone.
- **`invitation-observer.ts`**: the MutationObserver installed by `page.addInitScript` before any page script runs (inspects added nodes themselves, so a node inserted and removed inside one task is still seen; records in `window` and `sessionStorage` because a full navigation resets `window`), a request collector (URLs and POST bodies after a chosen point), and the cookie reader.
- **`invitation-existing-account.spec.ts`** (4 tests): **Case A, no MFA** (a throwaway account invited by the `admin` operator) and **Case B, MFA-enrolled and self-designated** (`mfa-enrolled` invited by itself, through the real `/totp` challenge: sign-in sends an MFA account straight to `/totp?callbackUrl=/invite`; the code is computed from `E2E_TOTP_TEST_SECRET`, with a next-time-step retry for a spent step). Both: open the link, "Sign in to accept", sign in, return to `/invite` by server-action redirect, the observer and immediate-count assertions, the cookie's exact attributes (`path "/"`, httpOnly, Lax, `domain` equal to the exact host with no leading dot, expiry within 1800 s), the token in no request URL or body between leaving the link and the Accept click, no token in any page URL, then **Accept** and the redirect to `/launch?next=/o/<slug>` landing on `/o/<slug>`, the cookie gone, and the **persisted outcome**: invitation `accepted_at` / `accepted_user_id` / `person_id`, the person linked at the org, `founding_administrator` among the granted roles, exactly the two audit rows `invitation.accepted` (`mode: existing_account`, `invitedByUserId`, `inviterIsInvitee` false in A / **true in B**) and `org.founding_administrator.designated` (`viaInvitationId`, `invitedByUserId`, `inviterIsInvitee`, `resource_id` = the org), metadata ids only, no token, hash or password anywhere in a row. B also opens the operator's org page and asserts the **"Self-designated"** badge. **Treasurer purpose, existing account**: a roster person whose on-file email is the invitee's; Accept links the person to the account, grants exactly the `treasurer` role, sets `contact_methods.verified_at`, writes `invitation.accepted` and `org.treasurer.designated` (permissionKeys `giving.manage`, `giving.record`, `giving.view`), and the 2FA wall stands in front of the congregation (see F167). **Signed in as a different account** (the `member` fixture): the page says so, shows only the masked address (`***@`), never the full one, and nothing is consumed.
- **`invitation-new-account.spec.ts`** (1 test, the first successful click-through of the create-account path): open the link and reload twice (heading, org, masked address each time, `accepted_at` still null, names prefilled, rules stated) → a 7-character password refused inline (`#invite-error`, `role="alert"`, entries kept) → a mismatch refused → **no `users` row and nothing consumed** → a valid password → `/invite/accepted` ("Your account is ready", no token in the URL) → **persisted**: the `users` row (one, `email_verified` set, `two_factor_required` true, bcrypt hash that does not contain the password), the invitation row, the new person (`Rosalind Thistlewood`) and its live **staff** membership (`engagement_status 'staff'`, no roll), the founding-administrator grant, exactly three audit rows (`invitation.accepted` `mode: new_account` with the new user as actor, `user.created_via_invitation`, `org.founding_administrator.designated`), ids only, and the token and its hash in **no** `audit_events` row and **no** `email_queue` row → "Sign in" → the standard form → `/totp` walks the unenrolled account to `/account/2fa` **enrolment** (secret read from the `<pre>` under "Can't scan? Enter manually", code computed with `otplib`, `user_totp` row persisted) → `/launch` → the proxy's 2FA challenge with `callbackUrl=/o/<slug>` → the code again → lands on `/o/<slug>` and **`/o/<slug>/admin/roles` renders the Roles page (authority)** → a fresh visitor opening the same link gets the one dead-link page and no create form.
- **`admin-organizations.spec.ts` Tests 7-8** (Phase 3 blast radius). Test 7 is rewritten onto a throwaway congregation with a roster treasurer (the old tests asserted an instant grant on the permanent `alpha` fixture): the control disabled until the email is valid, no "sign up first" sentence; the presbytery shows no section; an address nobody enrolled is refused in roster words ("Nobody enrolled at this congregation has that email on file") and **writes nothing** (invitation, mail, role counts); **a send** — the `AlertDialog` names the address, the organization and "nobody holds this role until it is accepted", the notice reads "Invitation sent … Nobody holds this access until it is accepted", the pending row replaces the form (and stays on a fresh load), one open `treasurer` invitation names the roster person and the operator, **no person, membership, grant or role was created**, one `email_queue` row (`account_invitation`, recipient, status `sent`, **both bodies equal the redaction marker**; a `queued` row is accepted only if it still carries the link, the named residual), one `invitation.created` audit row (ids only, actor the operator), no `org.treasurer.designated` yet; **Resend inside the cooldown** is refused with the single rate-limit literal inline and leaves no successor row, **Revoke** behind an `AlertDialog` marks the row revoked, audits `invitation.revoked` (`via: single`) and brings the form back; the 360 px test (nested, same throwaway org). Test 8 (new): the founding-administrator send half on two throwaway orgs — the dialog and the pending row, the queue row and audit, **no account, person or grant created by sending**; an address that **already has an account** (the `member` fixture) gets the **identical notice string**; the operator's own address adds only the `self-address-sentence` to the confirm and cancelling sends nothing.

### 3. F167 (found by the treasurer test; fixed in this batch, failing-first)

Phase 3 recorded: "a treasurer accepted from an existing non-2FA account is walked to `/totp` -> `/account/2fa` by the proxy on `/o/*`; no `unstable_update` is needed after accept." **The e2e proved that false.** The treasurer test, as first written, timed out waiting for `/account/2fa` (`run-pass-after2.log`): the invitee landed on `/o/<slug>` with no 2FA challenge. Cause: `jwt()` recomputes `twoFactorRequired` from the database on every run, but the PROXY reads the claim from the session **cookie**, and only an update re-issues the cookie; accepting a treasurer invitation adds giving keys (arm B of `presby_two_factor_required`) to an account whose cookie says "not required", so the edge wall was absent until the next sign-in. (The giving pages gate 2FA themselves from a fresh `auth()`, R4, so tier-2 data was not exposed; the gap was the edge wall the design relied on.)
- **Failing first:** the unit test "refreshes the session after an accept so the edge 2FA claim sees the new authority - regression for the treasurer reaching /o/<slug> without the wall" failed (`expected "vi.fn()" to be called 1 times, but got 0 times`), and the e2e treasurer test failed at the wait for `/account/2fa`.
- **Fix:** `acceptSignedInAction()` now calls `unstable_update({ user: {} })` after a successful accept and before the redirect, inside a `try/catch` (the invitation is committed, so a failed refresh must not turn success into an error; it logs a fixed string). Tests: update-then-redirect ordering, a rejected refresh still redirects, no refresh when nothing was accepted. After the fix: the treasurer test passes (lands on `/account/2fa?callbackUrl=/o/<slug>`) and Case B (already verified) still lands directly on `/o/<slug>` (the update preserves `twoFactorVerified`).
- The new-account path needs no refresh (a fresh sign-in issues a fresh cookie).

### 4. Findings and notes for integration (orchestrator; shared files not edited)

- **F166 (pre-existing, outside this pipeline; not fixed).** `/account/2fa` first-time enrolment: `completeEnrollment()` ends with `revalidatePath("/account/2fa")`, and the revalidated server tree replaces the client "Two-factor authentication enabled" panel with the already-enrolled management view within about a second. A probe (deleted) saw the recovery codes appear and then vanish (`codesSeen` true, then the settled text was "You enrolled on … 10 unused codes remaining"); the **"Continue" link, and with it the preserved `callbackUrl`, are gone**, and the fresh-codes cookie (`Path=/account/2fa`, set in the same response) is only read on the next load. Every new invitee who enrols through this flow loses sight of their recovery codes unless they reload `/account/2fa` within five minutes. Enrolling also does not verify the session, so the new account answers one more `/totp` challenge before `/o/<slug>` (the spec does this as a user would). Recommend a TODO line and its own bug-fix pipeline; the new-account spec deliberately asserts the settled management view rather than papering over it.
- **F167** as above (fixed). Add to the findings log with the architect's proposed finding about hand-off cookies (addendum 2, numbered F168 by the orchestrator): both are consequences of a server action's redirect rendering inside its own POST and of the proxy reading cookie claims.
- **DECISION-185 (amend in place)** per the architect's addendum-2 text is unchanged; **add** to DECISION-188/183 text or the findings: acceptance refreshes the session (F167).
- **TODO lines to add at integration:** F166 (recovery codes and `callbackUrl` lost after first enrolment); update the D-6 line to say the dead-link cookie now travels on every platform request for up to 30 minutes (addendum 2), still inert; the `email_queue` credential-body scrub for the other three templates (F154) stands.
- **Rule 15/14:** no change from this batch.

### 5. Gate results (full-stack-developer, 2026-10-21)

- `npm run typecheck`: pass. `npm run lint` (`--max-warnings=0`): pass. `npm run check` (all eight tripwires): pass. `check:secrets` scans tracked files only; run over every untracked and modified file (18): **one soft finding** (the throwaway `.invalid` password constant in `invitation-new-account.spec.ts`), annotated `// leak-ok:`; re-run clean.
- **Unit suite (`npm test`): 483 files passed, 7081 tests passed, 2018 skipped (DB-gated)** (Batch 3: 7067; +14 this batch). No DB-backed suite was affected (no schema, SQL function or library change); the Batch 1-2 DB suites were not re-run.
- **E2E, real dev server started from this worktree (`PORT=3500 npm run dev`, with `RATE_LIMIT_DISABLED`, `AUTH_TOTP_ENCRYPTION_KEY` from `.env.local`, the custom-domains fakes and `CRON_SECRET` the global setup demands), against `pipeline-invitations`, `E2E_ALLOW_SHARED_DB=true`, chromium project: one run of 72 tests, all green** (`run-all.log`): the new specs (existing-account 4, new-account 1, fixture-sweep 1), `admin-organizations.spec.ts` (17, of which 8 are the rewritten and new invitation tests), the auth specs `totp-full-login` (1), `totp-callback-bypass` (7), `branded-signin` (4), and `post-login-routing` (12), `admin-email-queue` (5), `security-headers` (20). (A first launch failed in `globalSetup` on a Neon `fetch failed` while provisioning users; it re-ran clean. Not a spec failure.) The dev server was stopped by PID (the `npm` parent and its three children); port 3600 was not touched.
- **Not run:** the production-build hydration lane (`npm run test:e2e:prod`; no spec was added for the three new forms, which are not `useForm` roots, so `check:hydration-gate` does not require one), `visual-parity`, and the Batch 1-2 DB suites.
- **Data left on `pipeline-invitations`:** none from the fixtures (verified by SELECT: no `e2e-invite-*` organization or user, no membership on `admin` / `member` / `mfa-enrolled`, invitations 15 = Batch 1's seed plus Batch 3's manual pass, no `email_queue` row to an `e2e-invite-*` address). **Audit rows stay by design** (append-only): about 38 `invitation.*` rows including Batch 3's. The four `account_invitation` queue rows still present are Batch 3's manual-pass sends, not this batch's.

### 6. Deviations and judgement calls

1. **One agent for Batch 4** (orchestrator's assignment), noted above.
2. **The Accept click's own POST carries the token** in its hidden form field (same origin, to the page that just rendered it); the "no token on the wire" proof is therefore asserted between leaving the link and the Accept click for URLs and bodies, and for URLs only during Accept. This is by design (R6 forbids the token in a URL, `callbackUrl`, audit or logs, not in a same-origin form body).
3. **Added beyond the brief**, because Phase 3's QA list asked for them: the treasurer existing-account case (which found F167), the mismatch case, the founding-administrator send half and the sender-uniformity check, and the fixture-sweep spec.
4. **The Phase 3 QA wording "assert the 'Self-designated' badge on the org page" is implemented in Case B** (operator's page, admin session).
5. **`actor_email` on an existing-account audit row is the actor's own address from their session** (Batch 2 deviation 8 already says so); the "ids only" assertion is on the metadata and on token / hash / password anywhere in a row, not on that column.

### Handoff to Phase 5 (qa)

- **What to run:** `npm run typecheck`, `npm run lint`, `npm run check`, `npm test`, then the e2e against a real dev server with the environment above: `E2E_BASE_URL=... E2E_ALLOW_SHARED_DB=true npx playwright test e2e/invitation-existing-account.spec.ts e2e/invitation-new-account.spec.ts e2e/invitation-fixture-sweep.spec.ts e2e/admin-organizations.spec.ts e2e/totp-full-login.spec.ts e2e/totp-callback-bypass.spec.ts e2e/branded-signin.spec.ts --project=chromium`. The auth-touching MFA gate is satisfied by Case B (the MFA-enrolled `mfa-enrolled` user through the real `/totp` code) and the new-account spec (a new account through `/account/2fa` enrolment and the `/totp` challenge).
- **Fail-before / pass-after to verify:** the observer assertions (arrival count, `deadLinkEverSeen`, cookie path) fail against `9e72e7c`'s `invite-cookie.ts` / `page.tsx` / `dead-link-state.tsx` / `recheck-once.tsx` and pass now; the F167 unit and e2e tests fail without the `unstable_update` call.
- **For the operator's browser pass:** repeat checklist steps 5 and 7 on a phone; the one thing a spec cannot judge is the recovery-code panel (F166).
- **Next agent:** qa (Phase 5).

---

### Integration: renderEmail adoption (full-stack-developer, 2026-10-21)

Ordered by Phase 2 R13. Review polish (PR #35, v0.36.0) merged to main first, so `origin/main` was merged into `pipeline/invitations` (the local polish branch was merged first, then `origin/main` on top; both merge commits are in history). One conflict, `src/lib/email/queue.ts` (imports only): kept the credential-key imports and re-export AND the `RenderedEmail` type import. `insertQueueRowInTx`, `attemptQueuedSend`, `cancelQueuedEmail` and the redaction auto-merged onto polish's `{ to, message, templateKey }` signature.

**Files changed**
- `src/lib/onboarding/invitation-email.ts`: builds the message with `renderEmail()` (heading "You're invited to PresbyPortal", greeting and role paragraphs, action button "Accept the invitation" with the printed link, expiry and ignore lines as the footnote). Subject, greeting, no-sender-text, no-address, escaping and the 100-character cap are unchanged. Returns `{ message: RenderedEmail, url }`.
- `src/lib/onboarding/issue.ts`: both `insertQueueRowInTx` callers (create, resend) pass `message: rendered.message`.
- Tests: `invitation-email.test.ts` (adapted; the URL appears three times in the html: button href, printed link href, printed link text; once in the text), `queue-credential.test.ts` (new `renderEmail` messages; new block proving that a URL with `&` appears escaped in the html and raw in the text, and that the sent-update bodies contain neither form).
- `e2e/support/invitation-ui.ts` (`submitTotp`) and `e2e/invitation-new-account.spec.ts` (`/account/2fa` enrolment) now use `enterTotpCode` from `e2e/support/totp-page.ts`: polish replaced the single code field with six digit boxes, so the old placeholder and `#totp-enroll-code` locators timed out. Found by running the specs; not a product defect.
- This work-log: the operator's own address, which had been written into two Phase 5/6 lines, is replaced with a placeholder (`check:secrets` flagged it; the repo is public).

**Scrub note (deviation from the brief's wording).** The shipped scrub is not a link rewrite: the same UPDATE that marks a credential row `sent` or `failed` (and `cancelQueuedEmail`) replaces the WHOLE `html_body` and `text_body` with `REDACTED_BODY_MARKER`. So no form of the link (raw, HTML-escaped, in the href, the printed copy or the text) can survive, and there is no `replaceAll` to extend. The token alphabet is base64url (no `&`); the new unit test proves both forms are gone anyway with a URL that contains `&`. `credential-keys.ts` is unchanged: Retry refusal (F158) and the queue-page Retry hiding still read the same set (`admin-email-queue` e2e green).

**Results**
- `npm run typecheck`, `npm run lint`, `npm run check` (all eight tripwires): clean.
- `npx vitest run` (pure): 492 files passed, 67 skipped; 7263 tests passed, 2018 skipped.
- DB tests, one file per process with `--no-file-parallelism` and `.env.local`: `issue.db.test.ts` 50, `accept.db.test.ts` 30, `invitations.db.test.ts` 66, `designation-parity.db.test.ts` 12, `giving/statements.db.test.ts` 24 (the notice goes through `renderEmail`), all passed. First runs of `issue.db` (hook timeout) and `statements.db` (ECONNRESET) were Neon flakes and passed on re-run.
- e2e on a dev server on port 3500 (Playwright started and stopped it; `RATE_LIMIT_DISABLED`, `E2E_ALLOW_SHARED_DB=true`): `invitation-new-account`, `invitation-existing-account` (4), `invitation-fixture-sweep`, `admin-organizations`, `admin-email-queue`, `totp-full-login`, `totp-code-entry`, `totp-recovery-code`: 49 in the first run, 47 passed and 2 failed (the TOTP-locator breakage above); after the e2e fix the three invitation specs pass 6/6.

# Phase 5 — Verification (qa)

**Date:** 2026-10-21
**Verified by:** qa (read-only; worktree `presby-invites`, HEAD `f807246`, clean before and after; `.env.local` points at `ep-autumn-mud-axr8kawo` / `pipeline-invitations`)

## Type Check

`npm run typecheck`: **PASS**. `npm run lint` (`--max-warnings=0`): **PASS**. `npm run check`: **PASS** on all eight tripwires (audit, sql-date, deps-drift, brand-scope, secrets, hydration-gate, giving-boundaries, proxy-imports). `npm run build`: **PASS**; `ƒ /invite` and `○ /invite/accepted` are in the route table and there were no warnings.

## Unit Tests

**Pure suite (`npx vitest run`):**
- 7081 passed, 0 failed, 2018 skipped, in 28.9 s.
- 483 files passed, 67 skipped.
- The skips are the DB-gated files. Every one of them was run separately below, so no skip goes unaccounted for.

**DB-backed, one file per process (`--no-file-parallelism`) against `pipeline-invitations`:**

| File | Result |
|---|---|
| `src/lib/db/domain/invitations.db.test.ts` | 66/66. The first run had one 20 s timeout at `:1042` (`ambiguous_person`, treasurer); it passed when re-run alone. |
| `src/lib/onboarding/designation-parity.db.test.ts` | 12/12, compared against the committed golden |
| `src/lib/onboarding/issue.db.test.ts` | 50/50 |
| `src/lib/onboarding/accept.db.test.ts` | 30/30 |
| `src/lib/onboarding/founding-administrator.test.ts` | 17/17 |
| `src/lib/onboarding/treasurer-designation.test.ts` | 11/11 |
| The other 68 DB-gated files in the repo | 62 green on the first pass. See the next three rows. |
| `children`, `event-types`, `giving/ingest/process.db`, `roll` | Green when re-run singly. The first-pass failures were all 20 s timeouts or `Connection terminated unexpectedly`. |
| `src/lib/org-features.test.ts` | 29/29 with `--testTimeout=90000`. It timed out twice at the default 20 s on its exhaustive axis × category × toggle loops. The one assertion failure in the first run came 3 s after the previous test timed out, while that test's queries were still running. `org-features.ts` is not in this diff. |
| `src/lib/db/fixture-deletable.test.ts` | **3 failed: environment, not this pipeline's code.** See Notes, item 1. |

**Migration and RLS:**
- `scripts/invitations/test-rls-59.sql` as `presby_app` (`rolbypassrls = f`; `assert_eq` was already installed): 36/36 passed, exit 0. Run before and after the re-apply below.
- **0059 idempotence:** I re-applied it twice as owner (`psql -1 -v ON_ERROR_STOP=1`). Both runs exited 0 with only the seven expected "already exists, skipping" notices.
  - Before and after snapshots are identical: row counts (users 32, people 763, memberships 125, role_grants 94, app_roles 102, invitations 15), plus fingerprints of function bodies, ACLs, owners and `search_path`, the table ACL, and the constraint/trigger/index counts.
  - All three guards are still `tgenabled = O`.
  - The file has no top-level `begin`/`commit`.

## End-to-End Tests

My dev server ran from this worktree (`PORT=3500 npm run dev`, with `RATE_LIMIT_DISABLED`, `AUTH_TOTP_ENCRYPTION_KEY`, the `DOMAINS_*` fakes and `CRON_SECRET`), with `E2E_ALLOW_SHARED_DB=true` and the chromium project. Every server I started (3500, 3510, 3520) was stopped by its own PID tree. Port 3600 was never touched.

**Main run: 72 passed, 0 failed, 0 skipped, in 3.7 min.**

| Spec | Passed |
|---|---|
| `invitation-new-account` (MFA enrolment path) | 1 |
| `invitation-existing-account` (Case A, Case B with real `/totp`, treasurer, wrong account) | 4 |
| `invitation-fixture-sweep` | 1 |
| `admin-organizations` | 17 |
| `totp-full-login` | 1 |
| `totp-callback-bypass` | 7 |
| `branded-signin` | 4 |
| `post-login-routing` | 12 |
| `admin-email-queue` | 5 |
| `security-headers` | 20 |

**Hydration, dev lane:** `e2e/hydration/` passed 8/8.

**Hydration, production lane:** `npm run test:e2e:prod` with `PW_PROD_PORT=3950` passed 72/72 (8 `prod-build` + 64 `prod-custom-hosts`), with no skips. Playwright tore down its own server.

**Pre-hydration probe of the new accept form:** I ran a scratch script that holds the JS chunks, opens a seeded live invitation anonymously at 360 px, and inspects the form (preview only, nothing consumed).
- Before hydration, the `HydrationGate` fieldset is `disabled` and `aria-busy`, `#invite-password` and the submit button match `:disabled`, and typing is refused.
- After hydration, the form is enabled.

**Mandatory auth gate is satisfied:**
- Case B: the MFA-enrolled seeded user, through the real `/totp` code.
- The new-account spec: `/account/2fa` enrolment, then the `/totp` challenge, then `/o/<slug>`.

## Regression Tests Added

| Test | Location | Guards against | Fail-before / pass-after |
|---|---|---|---|
| Observer e2e, Case A | `e2e/invitation-existing-account.spec.ts:80` | Dead-link flash after sign-in, plus `Path=/invite` (addendum 2) | **Reproduced by me**: HEAD spec against a scratch server built from `9e72e7c`, the parent of fix commit `a0ffa0c`. Failed on exactly the three assertions: `:114` immediate count (expected 0, got 1), `:118` observer flag (expected false, got true), `:124` `cookie.path` (expected `"/"`, got `"/invite"`). Passes at HEAD. |
| Observer e2e, Case B | same file `:183` | Same | Failed at `:219`, `:222`, `:227`; passes at HEAD. The mismatch case passed in both runs, matching the implementer's log. |
| `is Path=/ - regression for the dead-link flash…` | `src/lib/onboarding/invite-cookie.test.ts:19` | Cookie path | Mutation test (path set back to `/invite` in a scratch copy of HEAD): failed, along with seven dependent cookie tests. Passes at HEAD. |
| Empty token renders plain dead-link markup | `src/app/(invite)/invite/page.test.tsx:83` | `RecheckOnce` patch returning | Passes at HEAD; I confirmed `recheck-once.tsx` is gone. |
| F167 unit: `refreshes the session after an accept…` | `src/app/(invite)/actions.test.ts:222` | Treasurer reaching `/o/<slug>` without the 2FA wall | Mutation test (only `unstable_update` removed): exactly this test failed, `expected "vi.fn()" to be called 1 times, but got 0 times`. Passes at HEAD. |
| F167 e2e: treasurer case | `e2e/invitation-existing-account.spec.ts:283` | Same | In the `9e72e7c` tree it fails earlier, at `:309` (the flash), which hides F167. So I ran it against a HEAD copy with only `unstable_update` removed: Case A and Case B passed, and the treasurer case timed out at `:317` waiting for `/account/2fa`. Passes at HEAD. |
| F157 route tree and named-pins regressions | `src/lib/reserved-slugs.test.ts:55`, `:62` | `RESERVED_SLUGS` drift | Passes. I relied on the Batch 0 fail-before record. |

## Coverage on Critical Modules

| Module | Statements | Target |
|---|---|---|
| `src/lib/permissions.ts` | 100% | 100% |
| `src/lib/two-factor.ts` | 91.3% (uncovered lines 35–39) | 90%+ |
| `src/lib/flags.ts` | 100% | 100% |
| New pure modules (`invitation-token`, `input`, `status`, `labels`, `invite-cookie`, `credential-keys`) | 100% | |
| `invitation-email.ts` | 100% statements, 90% branch (line 91) | |

## Feature-Gate Audit

I verified each row by reading the bodies. No `src/app/api/**/route.ts` file is in the diff.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `inviteFoundingAdministratorAction` (`(admin)/admin/organizations/[id]/actions.ts:824`) | yes | yes (`:826`) | `FEATURES.ADMIN_ORGANIZATIONS` |
| `inviteTreasurerAction` (`:869`) | yes | yes (`:871`) | `FEATURES.ADMIN_ORGANIZATIONS` |
| `resendInvitationAction` (`:928`) | yes | yes (`:930`) | `FEATURES.ADMIN_ORGANIZATIONS` |
| `revokeInvitationAction` (`:959`) | yes | yes (`:961`) | `FEATURES.ADMIN_ORGANIZATIONS` |
| `revokeAllInvitationsAction` (`:993`) | yes | yes (`:995`) | `FEATURES.ADMIN_ORGANIZATIONS` |
| GET `/admin/organizations/[id]` (`page.tsx:81`; now reads invitation rows with full addresses) | yes | yes (`:82`) | `FEATURES.ADMIN_ORGANIZATIONS` |
| `retryEmailAction` (`(admin)/admin/email-queue/actions.ts:36`; changed for F158) | yes | yes (`:38`) | `FEATURES.ADMIN_EMAIL_QUEUE` |
| `acceptSignedInAction` (`(invite)/actions.ts:219`) | yes | n/a: the token is the credential (DECISION-147/183). G9 check at `:225`. Identity comes from the session only. | n/a |
| `acceptNewAccountAction` (`(invite)/actions.ts:157`) | yes, used to refuse when a session exists (`:165`) | n/a: anonymous and token-gated by design, with an IP rate limit and a local-login check | n/a |
| `startSignInToAcceptAction`, `continueToVerifyAction`, `switchAccountAction` | no, by design: they only write the visitor's own token into a cookie | n/a | n/a |
| GET `/invite`, GET `/invite/accepted` | page calls `auth()`; `previewInvitation` receives only `session?.user?.id` (D-3) | n/a (exact `PUBLIC_PATHS` entries, `src/proxy.ts` diff) | n/a |

## Schema/RLS Audit

Checked against the live catalog on the pipeline branch:
- `account_invitations` has `relforcerowsecurity = t` and one `tenant_isolation` policy (using and with check on `presby_current_org()`).
- `aclexplode(relacl)` shows only the owner and `presby_platform: SELECT`. There are no column ACLs.
- The three guard triggers are present and enabled.
- All 7 functions are `SECURITY DEFINER`, owned by `neondb_owner`, with `search_path = public, pg_temp`.
- `presby_app` holds EXECUTE on only `presby_preview_invitation(text,uuid)` and `presby_accept_invitation(text,uuid,text,text,text)`. There is no PUBLIC EXECUTE anywhere.
- The indexes include D-2 `account_invitations_open_designation_uq` and D-1 `account_invitations_resent_from_uq`.

Which layer actually refuses each attempt (all probes rolled back):

| Probe | Connection | Refused by |
|---|---|---|
| SELECT, UPDATE, DELETE on the table; EXECUTE on `presby_giving_manage_holder_count` and `presby_apply_treasurer`; SELECT even with an org GUC set | `presby_app` | **The grant** (`permission denied`). RLS is never reached; it stays in place as the second layer for Increment 2. |
| Accept or block without the marker; editing an identity column (`token_hash`); DELETE | owner (`neondb_owner`, `rolbypassrls = t`) | **The triggers** (`…accepted only through presby_accept_invitation()`, `…blocked only through…`, `…one legal transition…`, `…rows are permanent…`). |
| R5: raw token vs its stored SHA-256 hex | `presby_app` | The raw token previews 1 row; the hash previews 0. The address comes back masked (`i***@example.invalid`). |

## Binding Rulings Honoured

- **R1–R8, R10:** verified in the catalog and in `accept.ts`, `issue.ts`, `queue.ts`, `invitation-email.ts`, `next.config.ts` and `src/proxy.ts`. In particular:
  - `accept.ts` uses only `db`, and its audit rows are written in the same transaction.
  - `issue.ts` uses only `getPlatformDb()`, never reads `users`, and supersedes first.
  - The limits are bounded above by `now()`.
  - The link is built only from `platformOrigin()`.
  - The `origin` CHECK still allows only `platform`, so Increment 2 has not leaked in.
- **R3:** `src/auth.ts`, `src/lib/auth/`, `(auth)/`, `api/auth/` and `launch/` have no diff.
- **R9 as reversed:** no refusal; `inviterIsInvitee` is stamped on both rows; the "Self-designated" badge shows (`invitation-list.tsx:121`).
- **D-1 to D-8:** both indexes are live. Both index names map to `already_pending` (`issue.ts:89`). `p_user_id` comes from the session only. `isTotpConfigured()` is checked for both purposes. The marker is re-armed on the blocked path (0059 `:1328`). The `account_exists` mapping is scoped to `users_email_unique` (`:1280`). `email_queue_id` is set at insert.
- **Contradiction 2:** the existence checks use `lower(u.email)` (`:851`, `:1061`).
- **Addendum 2:** host-only `Path=/`, `__Host-invite_token` in production, `INVITE_PAGE_PATH` split out, `RecheckOnce` deleted, boundary scan added.

## Audit (Rule 7) and the Token

- Each outcome's audit row is proven in its own transaction by `issue.db` (50) and `accept.db` (30).
- I also scanned every `invitation.*`, `user.created_via_invitation` and `org.*.designated` row live on the branch (73 rows). None contains a token-shaped string, a 64-hex hash or an `@`. The metadata keys are ids only.
- After all runs, no `account_invitation` queue row in `sent`, `failed` or `cancelled` carries a link. The rows I saw mid-run with a link were `issue.db`'s own fixtures, and its cleanup removed them.
- The e2e asserts that the token is in no URL, no `audit_events` row and no `email_queue` row.

## Notes (non-blocking)

1. **`fixture-deletable.test.ts` fails because of residue on the pipeline branch.** It reports 78 people and 101 organizations whose deletable windows have closed.
   - The organizations were created at 18:15–18:22 UTC by the `domains-svc` fixture and at 18:41 UTC by the `ingest-apply` fixture. The people expired in the same 20:xx UTC window, and the "Dom Holder" sample name points to the same domains fixture.
   - That matches the Batch 0 combined `domains` + `giving` run that "cascaded 48 failures" after a Neon timeout.
   - None of those orgs has an invitation, and my runs added none.
   - It goes away when the branch is deleted at cleanup. Whoever runs the post-merge suite on `development` should include this file.
   - The underlying weakness, teardown in those two fixtures not surviving a connection drop, existed before this pipeline and is worth a TODO line.
2. **The Neon branch was flaky throughout:** 20 s timeouts and `Connection terminated`. Every affected file passed when re-run singly; `org-features` needed `--testTimeout=90000`.
3. **Test names:** the observer e2e tests don't carry the "— regression for …" suffix. Their unit counterparts do, and the F167 unit test uses a hyphen instead of an em dash.
4. **Fixed-string `console.error` in production paths:** `(invite)/actions.ts:254`, `accept.ts:316`, `issue.ts:574`/`:730`. They log an error class only, never the token. There is no `console.log`.
5. **Residuals already on record:** F166 (recovery codes and `callbackUrl` lost after first enrolment, pre-existing), D-6 (the dead-link cookie now goes with every platform request for up to 30 minutes, still inert), and the link stays at rest in `email_queue` while a row is `queued`.

## Verdict

**PASS.** Every required check is green, including the stricter auth-touching gate: e2e ran against a real dev server, through both the MFA-enrolled seeded user and the new-account enrolment path. Fail-before / pass-after is reproduced for the addendum-2 observer test and, in isolation, for F167, both unit and e2e. The feature-gate audit, the live-catalog Schema/RLS audit and the binding-rulings check are clean.

---

**Per-Phase Status:** | 5 — Verification | qa | Complete | PASS | 2026-10-21 |

**Handoff:** Next is **analyst, Phase 6 (Shipped vs Intent)**. Two items for integration: Note 1, which needs `fixture-deletable` run on `development` after the merge, and the existing Batch 1 caveat that `scripts/test-rls.sql` stops at section 2 because of the Alder Creek demo membership.

**Evidence** is in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/6e3e960d-cf0c-43df-b4c9-d41f1a6a4811/scratchpad/qa/`:
- `e2e-head.log`, `e2e-fail-before.log`, `e2e-f167-mutant.log`
- `e2e-hyd-dev.log`, `e2e-prod.log`
- `rls59.log`, `rls59-after.log`
- `snap-before.txt`, `snap-after.txt`
- `dbrest/` (per-file DB logs)

---

# Phase 6 — Shipped vs Intent (analyst)

*2026-10-21. Read-only. I did not start a server or run anything. I checked the shipped feature against my Phase 1 review through the work-log, QA's Phase 5 evidence, and spot reads of the code. The spot reads covered the email copy, the labels, the invite page state machine, the resend webhook, the sent notice, and a grep of `src` and `e2e` for the old "sign up first" copy. The only hit is the e2e assertion that the phrase is absent.*

## VERDICT

**SHIP WITH NOTES.** Everything Phase 1 promised for the platform designations ships and is verified on a real server, including both MFA paths. Two things the operator should know before using it in production:

- **Staff and Roles half not built.** The backlog line this pipeline set out to close is only half closed. The org-level "Invite to sign in" is Increment 2, which has no Phase 3 design yet.
- **Every new invitee hits the F166 detour.** F166 is the pre-existing first-enrolment bug. The recovery-code panel vanishes and the `callbackUrl` is lost.

Neither is a defect in what was built. Each is a tracked follow-up below.

## ONE-LINE TAKE

> A platform operator can now invite a founding administrator or first treasurer by email. The recipient proves mailbox ownership with a single-use link, then creates an account or signs in to one they have, and only then receives the access. The sender's screen is identical whether or not the address has an account. The staff-and-roles half of the original request, and a clean first-time 2FA enrolment, are still open.

## What's Working

- **The operator's blocker is gone.** "The account did not exist yet" can no longer happen. Both false "sign up first" strings and the section hint are removed. e2e `admin-organizations.spec.ts:602` asserts the phrase is absent.
- **No enumeration on the sender side.** The send path never reads `users`, which is source-scanned. The e2e asserts that an address with an account and one without get the identical notice string. The refusals describe the org or the roster, never the account.
- **The preview consumes nothing.**
  - The e2e reloads twice and the link survives.
  - The dead-link page is byte-identical for unknown, expired, revoked, superseded, used, blocked and empty tokens.
  - The honest messages (blocked reasons, `account_exists`, mismatch) appear only after the token is proven.
- **The token stays out of URLs.**
  - The hand-off cookie fix is the strongest piece of QA evidence. The observer e2e fails on `9e72e7c` on exactly the three assertions and passes now. QA reproduced that independently.
  - F167 (the treasurer reaching `/o/<slug>` without the 2FA wall) was found by an e2e and fixed failing-first.
- **Consent and 2FA are enforced where they matter.**
  - Existing accounts must click Accept.
  - A 2FA-required account needs a verified session (G9).
  - Self-designation is allowed and audited as the operator ruled: `inviterIsInvitee` is on both audit rows and the org page shows a "Self-designated" badge.
- **The credential does not linger.** After send, the stored body is replaced by a marker, and cancel and failed rows are scrubbed too. Retry on a scrubbed row is refused and points to Resend (F158).
- **The email is as promised.** I read it: platform-origin link only, greeting by first name, no sender free text, the invited address never in the body, names escaped and capped.
- **Delivery state is honest.** Bounce outranks delivery. The label "Bounced. Check the address" is exactly what Phase 1 asked for.

## Intent-vs-Shipped Diff

- Phase 1 said (C1): every designation is pending until the email owner accepts. Shipped: yes, including existing accounts. **Matches.**
- Phase 1 said (C2, Flow 6, G13): an org-level "Invite to sign in" action and "No login yet" markers, so grants to people with no login stop being silently inert. Shipped: not in this pipeline. Phase 1's own batch order made it Increment 2, and R10 requires a Phase 2 addendum first. **Acceptable drift, but it changes what "done" means.** See Follow-Up 1.
- Phase 1 said (Flow 4, G4): the token rides `callbackUrl`. Shipped: a host-only `Path=/` httpOnly cookie, `__Host-invite_token` in production. This follows R6 and addendum 2. **Acceptable drift, better than my design.**
- Phase 1 said (Flow 3): sign-in, then 2FA enrolment if required, then `/launch`. Shipped: the same, but a new invitee passes through F166.
  - The recovery codes appear, then vanish within about a second.
  - The "Continue" link and `callbackUrl` are lost.
  - The account answers one more `/totp` challenge before landing.
  - This bug is pre-existing and outside the pipeline. This feature routes every new invitee through it. **Acceptable drift with a high-priority follow-up.**
- Phase 1 said (G5, Q6): scrub the link after send, with TODOs for the other templates. Shipped: invitation key only, plus the cancel and failed paths. **Matches.**
- Phase 1 said (G18, Q9): address redaction 90 days after the invitation ends. Shipped: the columns and comments exist, but the sweep does not. The migration comment states "not enforced". **Matches the ruling** (S6). The release note must not claim it.
- Phase 1 said (C4, G11, Q8): ship a Google claim function and contract. Shipped: nothing is wired. R3 removed the claim from `signIn` and `jwt`, so Increment 3 is now "configure Google, add `email_verified` hardening, add a Flow 4 e2e". **Acceptable drift by ruling.**
- Phase 1 said (G7): durable limits plus an IP layer. Shipped: 20/10/3 per 24 h, 5-minute cooldown, 5 resends per chain, and an IP limiter on accept. A resend counts as a send. **Matches.**
- Phase 1 said (G8, G9, G17, G19): the local-login-off and TOTP-unconfigured checks, the 2FA-verified session, the 72-byte password limit, and the `do_not_contact` warning. Shipped: all present and tested. **Matches.**
- Phase 1 said (G14): audit events. Shipped: all six keys plus the designated rows with `viaInvitationId`. They are ids only, proven one test per outcome. QA scanned 73 live rows. **Matches.**
- Phase 1 said (R9 reversal): the platform role confers nothing. Shipped: acceptance goes through the same token, email match, confirm click and, for existing accounts, a verified session. **Matches the operator's ruling.**
- Phase 1 said (adversarial pass): redirect targets, state-machine shortcuts, cross-tenant exposure. Shipped: confirmed.
  - The only redirects are the static `/invite` and the slug read from the function's row.
  - `previewInvitation` takes only the session id (scan-enforced).
  - Presby_app holds no table privilege; QA confirmed it against the catalog.
  - The sign-in-to-accept hand-off cannot reach another invitation's org.

## Edge Cases

- **Empty state: pass.** An org with no invitations shows the form. The failed-list read shows an alert, not an empty list. The `/no-organization` page gains the "If you were invited, open the link in your invitation email." sentence (S7).
- **Failure microcopy: pass, with one nit.**
  - Good: "Email delivery is delayed; we'll keep trying", "We can't finish setting up your account right now. Your link is still good.", and one literal for every rate limit.
  - Nit: a failed Resend or Revoke renders under the shared "Not sent." prefix in `invitation-sent-notice.tsx`. That reads wrong for a revoke.
- **Permission gate: pass.** The five admin actions, the org page and `retryEmailAction` check `auth()` then the key. The accept path is token-gated by design. QA read every body.
- **Audit event: pass.**
- **Mobile (360 px): pass.** The ux-developer browser pass found no overflow and 44 px controls. The admin e2e has a 360 px case. QA's pre-hydration probe at 360 px showed the new accept form is inert until hydrated. I did not re-browse.
- **Untested path, not a failure:**
  - The e2e covers an existing account that is not 2FA-required (Case A) and one that is enrolled (Case B).
  - It does not cover an existing account that is 2FA-required but not yet enrolled. That is likely the shape of the hand-made `the operator's own test account` account in checklist step 10.
  - The design says it works: the "verify" state, then `/totp`, then `/account/2fa`. After enrolment F166 drops the `callbackUrl`, so the invitee must reopen the email link. The 30-minute cookie also helps.
  - This should be walked once manually and then get its own spec.

## Follow-Ups (SHIP WITH NOTES: each becomes a `docs/TODO.md` line in the integration commit)

1. `- [ ] **Invitations Increment 2: org-level "Invite to sign in" + "No login yet" markers (C2/G13/Flow 6).** Edit, do not close, the existing backlog line "Invitation flow for a person with no account (founding-administrator Flow 2 / G4)": Increment 1 closed only its platform-designation half. Until this ships, the second person a founding administrator creates through Staff has no login. Needs the R10 Phase 2 addendum first: tenant write path under withOrgContext, column-limited SELECT excluding token_hash, F155 (no cross-org signal to the sender), Q5 subset-rule feasibility. Priority: before the first customer onboards its own staff. — 2026-10-21-invitations Phase 6`
2. `- [ ] **F166 bug-fix pipeline: /account/2fa first enrolment loses the recovery codes and callbackUrl** (revalidatePath replaces the client panel; the fresh-codes cookie is read only on the next load). Every new invitee hits it and answers one extra /totp challenge. Fix before the first non-operator invitee is onboarded. — 2026-10-21-invitations Batch 4`
3. `- [ ] **e2e: existing account that is 2FA-required but not enrolled accepts an invitation (verify state, /totp, /account/2fa, reopen link, Accept).** Not covered by Cases A/B; the stopgap production account is probably this shape. Walk it manually at checklist step 10, then write the spec. — Phase 6`
4. `- [ ] **Invitations Increment 3: Google.** Configure Google, add email_verified === true to evaluateSignIn(), add a Flow 4 e2e through Google. No claim in signIn/jwt (R3, DECISION-187). — Phase 2/6`
5. `- [ ] **F154: scrub credential bodies for password_reset, email_change_verify and statistics_submission_grant.** Add the keys to src/lib/email/credential-keys.ts; one edit also makes Retry refuse them. — Phase 2/4`
6. `- [ ] **S6: owner-only sweep on the maintenance cron that nulls account_invitations.email_normalized 90 days after an invitation ends (redacted_at).** Not built. The release note and any user-facing text must not claim redaction. — Phase 2/3`
7. `- [ ] **D-6: the hand-off cookie is not cleared on a dead link; with Path=/ it now travels on every platform request for up to 30 minutes.** Inert (httpOnly, dead token). — addendum 2`
8. `- [ ] **Founding-administrator holder-count asymmetry:** the FA count's group arm has no date window and no membership join, while the giving count is membership-aware (lifted verbatim in 0059; pinned by a DB test). Needs a ruling. — Batch 1 deviation 6`
9. `- [ ] **requestEmailChange says "That email is already in use" to any signed-in user** (existing enumeration leak, noted in Phase 1). — Phase 1`
10. `- [ ] **Possible lower(users.email) index** if users grows (needs a schema.ts change, not a hand migration); the new-account existence check is a sequential scan. — Batch 1`
11. `- [ ] **Fixture teardown weakness: domains-svc and ingest-apply fixtures leave people and orgs behind when a connection drops** (fixture-deletable.test.ts reports 78 people and 101 orgs past their window on the pipeline branch). Run fixture-deletable on development after the merge. — QA Note 1`
12. `- [ ] **Copy nit: a failed Resend or Revoke shows under "Not sent."** (invitation-sent-notice.tsx); use a neutral prefix. — Phase 6`

**Integration items owed (orchestrator; recorded for continuity, not new TODO lines):**

- Convert `account_invitation` to `renderEmail` after polish merges. The accept URL must stay an unchanged substring in the href, the printed link and the text, and the scrub must `replaceAll` across the escaped and raw forms.
- `scripts/test-rls.sql`: the Alder Creek count of 10 vs 9.
- Apply 0059 to production by hand, with a snapshot first, before the merge deploys.
- Reconcile the runbook. Phase 3's integration text says apply "without `psql -1`", but Batch 1 and QA ruled that 0059 has no inner transaction and must be applied with `-1`. Write `docs/deployment.md` the Batch 1 way.
- DECISION-183 text: replace "an inviter may not accept their own invitation" with the operator's self-designation sentence.
- DECISION-184 should name `resent_from_id`, the D-1 and D-2 indexes, and the `BEFORE INSERT` born-open and chain guard.
- DECISION-185: the `Path=/` and `__Host-` cookie amendment.
- DECISION-188: the outcome contract and the F167 session refresh.
- Findings F153–F159, F166, F167, and F168 (the server-action-redirect and hand-off-cookie finding).
- CLAUDE.md: the credential-as-third-mechanism sentence, `(invite)` added to the un-brandable list, and the operator's Two Hierarchies sentence. Also the `.claude/agents/architect.md` route-group bullet.
- Rule 15: `docs/architecture.md:100` genuinely changes. The first administrator becomes "a platform-issued credential the designee accepts, applied by a SECURITY DEFINER function", and the module path moves.
- Rule 14: the functionality map.
- Rule 12: no feedback row. This originated in the operator's production test, not in-app feedback.
- Rule 13: no what's-new entry. This is operator tooling plus a pre-membership onboarding page.
- Release note must not claim 90-day redaction, Google sign-in, or that the other email templates are scrubbed. It may state the link is at rest while a row is `queued`.
- QA's nits (observer e2e test-name suffixes, the fixed-string `console.error` lines) are not worth tracking.

## Operator checklist: confirmed, with corrections

The 11 steps are the right manual production test. They need a prerequisites block and the following corrections.

**Step 0 (add): prerequisites and cautions**

- **Migration:** 0059 is applied to production before the deploy.
- **Env, each missing item changes what a step can show:**
  - `NEXT_PUBLIC_APP_URL` must be the production https origin. Without it, sends refuse with `link_origin_unavailable`.
  - `AUTH_TOTP_ENCRYPTION_KEY` must be set. Without it, sends are refused as "totp unavailable".
  - `RESEND_WEBHOOK_SECRET` must be set. Without it, rows stay "Sent" forever, so steps 2 and 8 cannot show "Delivered" or "Bounced".
  - `auth.local_login` must be on. Otherwise `/invite` offers no password form.
- **Use a congregation made for testing.** Acceptance creates permanent records: a person, a membership, role grants, and audit rows. People and organizations cannot be deleted. A founding administrator or treasurer accepted on a real congregation also blocks a later real designation (`has_holders`) until removed through role tools.
- **Per-address limit:** three invitations per recipient address per 24 hours, across all orgs. Resends count and revokes do not refund. Ten per org and 20 per inviter per 24 h. Testing steps 2, 5, 8 and 10 against one inbox will hit "Too many invitations right now." Use plus-addresses or separate inboxes.
- **Mailbox for steps 2 and 5:** the address must have no account. Use `+tag` variants; they are distinct addresses.

**Step-by-step**

1. **Confirmed.**
   - Also confirm the treasurer form appears only on a congregation or new worshiping community.
   - An org that already has a holder shows the lockout-recovery sentence.
2. **Confirmed, reword.**
   - The page does not auto-refresh. Reload to see Sent move to Delivered, and only with the webhook secret.
   - The treasurer sentence says "access", not "role".
3. **Confirmed, with specifics.**
   - Sender is the platform domain.
   - Subject is "You're invited to PresbyPortal for <congregation>".
   - Greeting is "Hello <first name>,".
   - The link is `<production origin>/invite?token=…`, never a church host.
   - After the polish PR merges, also confirm the styled button and the printed link both work.
4. **Confirmed.** Use a private window; a same-browser operator session changes the page. The masked address looks like `r***@domain`, and the names are prefilled.
5. **Confirmed with two corrections.**
   - **Sequence.** "Sign in → 2FA enrolment → land" is really:
     - `/totp` leads to `/account/2fa` enrolment.
     - **Copy the recovery codes the moment they show.** F166 can remove the panel within about a second. If it vanishes, reload `/account/2fa` within five minutes.
     - The "Continue" link is gone.
     - The account answers one more `/totp` code, then lands in `/o/<slug>`.
   - **Audit rows.** The expected rows are `invitation.created`, `invitation.accepted`, `user.created_via_invitation` and the designated row. "IDs only" means the metadata: no token, hash, password or address.
     - The new-user rows have a blank actor email.
     - Existing-account rows show the actor's own address in the actor column.
6. **Confirmed.** Reload and re-open both land on the same dead-link page as a made-up token.
7. **Confirmed with additions.**
   - The operator account must be 2FA-enrolled.
   - Flow: "Sign in to accept" → credentials → real `/totp` code → back at `/invite` ("Accepting as <name> at <congregation>") → Accept → `/o/<slug>`.
   - If no person is on file at that congregation with that email, acceptance creates one from the invitation's names. That is a permanent record.
   - Expect `inviterIsInvitee: true` on both audit rows, and "Self-designated" on the org page.
   - The second half (signed in as a different account) is correct: masked address and a sign-out button.
8. **Confirmed with limits.**
   - Resend inside five minutes shows the one rate-limit literal, "Too many invitations right now. Try again later."
   - After a resend, the old link is dead and the new one works.
   - Revoke kills the link and brings the form back.
   - For bounce, use Resend's simulator address. It needs the webhook secret.
   - A resend and the replacement invitation both count toward the per-address limit.
9. **Confirmed, with one part not testable.**
   - A roster person with an on-file email and active membership is required (F159).
   - The "nobody enrolled" message is correct.
   - `/admin/email-queue` shows the row with the body replaced by "[Removed after delivery: this message contained a one-time sign-in link.]".
   - A `failed` credential row cannot be produced on demand. Skip the "Retry points to Resend" half; unit and e2e tests cover it.
10. **Confirmed, with two corrections.**
    - The stopgap account `the operator's own test account` is the treasurer-test account, so this is a treasurer invitation. The congregation needs a roster person with that email on file, or the send refuses.
    - Run it twice if possible, once with 2FA enrolled and once not. The unenrolled case is the untested path in Follow-Up 3. It works through the "verify" state and `/account/2fa`, but F166 drops the `callbackUrl`. If you land elsewhere, re-open the email link. The 30-minute cookie carries the token.
    - Also confirm: "Create your account" answers "An account already exists… sign in to accept". After accept, the treasurer lands at `/account/2fa?callbackUrl=/o/<slug>` if not yet enrolled (F167).
11. **Confirmed.** Repeat 4, 5 and 7 on a phone at 360 px. A form entered before hydration is refused.

**Add**

- **Step 12, revoke all.** On an org with a pending founding-administrator and treasurer invitation, use "Revoke all open invitations". Both links die and the form returns.
- **Step 13, `/no-organization`.** Signed in with no congregation, confirm the page now says "If you were invited, open the link in your invitation email."

## Per-Phase Status

| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-10-21 |

## Handoff

**Next: the orchestrator.**

1. Integrate after the review-polish merge, through `/merge-pr`, applying the integration items above.
2. Apply the twelve follow-ups to `docs/TODO.md` in the same commit (Rule 10).
3. Split the old backlog line rather than closing it.
4. Update the operator's checklist artifact with the prerequisites block and corrections above.

Start the F166 bug-fix pipeline (tech-lead, brief Phase 3) after both merges. Increment 2 is a separate Feature pipeline and needs the architect's R10 addendum before its Phase 3.

**Files referenced:**
- `/Users/cshenso/git/presby-platform/presby-invites/docs/work-log/2026-10-21-invitations.md`
- `/Users/cshenso/git/presby-platform/presby-invites/src/lib/onboarding/invitation-email.ts`
- `/Users/cshenso/git/presby-platform/presby-invites/src/lib/onboarding/labels.ts`
- `/Users/cshenso/git/presby-platform/presby-invites/src/lib/onboarding/status.ts`
- `/Users/cshenso/git/presby-platform/presby-invites/src/app/(invite)/invite/page.tsx`
- `/Users/cshenso/git/presby-platform/presby-invites/src/app/(admin)/admin/organizations/[id]/invitation-sent-notice.tsx`
- `/Users/cshenso/git/presby-platform/presby-invites/src/app/api/webhooks/resend/route.ts`
