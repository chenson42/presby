# Invitations for people without an account — Work Log

> **Slug:** `2026-10-21-invitations`
> **Surface:** mixed — invitation acceptance (auth-adjacent, platform chrome); platform admin designations; org admin staff/roles
> **Permission(s):** TBD in Phase 1 (existing designation/grant permissions likely cover sending; acceptance is token-gated)
> **Flag(s):** no new platform flag (operator rule); per-org gating only if Phase 1 finds a need
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
| 3 — Technical design | tech-lead | In progress | — | 2026-10-21 |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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

## Implementation Order

1. Schema (if any) → `npm run db:push` on a Neon branch
2. `FEATURE_CATALOG` entry + seed binding
3. Route handlers / server actions
4. UI
5. Audit events for security-sensitive paths
6. Release notes entry

## Edge Cases & Risks

- [Thing that could fail or that needs special handling]

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
