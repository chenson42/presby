# Archive revokes an open sign-in invitation (F417) — Work Log

> **Slug:** `2026-11-02-archive-revokes-invite`
> **Surface:** (org) Community admin (`/o/<slug>/admin/community`), the invitation acceptance page
> **Permission(s):** existing `people.manage` covers this
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant
> **Numbers (pre-assigned):** F417; DECISION-315 if a decision is needed; no migration expected (if one is, 0085); port 3580; Neon `pipeline-archive-revokes-invite` (`br-mute-voice-axvymkss`)
> **Source:** analyst live walk of Community Increment 3a (0.54.0), D1. See the "Phase 6 addendum — live walk" in `docs/work-log/2026-10-22-founding-admin-directory-inc3.md`.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Done: D1 in the 3a live-walk addendum is the bug confirmation | Bug confirmed | 2026-11-01 |
| 2 — Architectural review | architect | Skipped, noted in the Phase 2 section: no migration, no definer change, no dependency, 2b B2 boundary kept | — | 2026-11-02 |
| 3 — Technical design | tech-lead | Done: ruling is both (a) archive revokes in-transaction, `invitation.revoked` via `archive`, and (b) the reader treats a stored `membership_ended` block as stale over a live membership; no migration | Design complete | 2026-11-02 |
| 4 — Implementation | full-stack-developer | Done: (a) archive revokes in-transaction, (b) reader backstop, C1 and H1-H3, tests red-then-green; no migration | Complete | 2026-11-02 |
| 5 — Verification | qa | Regression red on `d530c41f` (8 soft failures), green at HEAD; unit 13,247; DB 76 + 269; e2e dev 56/56, prod 6/6; D1, (b) and the real participant void walked at 360px | PASS | 2026-11-02 |
| 6 — Shipped vs intent | analyst | D1 walked at 360px light/dark on record and list; re-invite accepted end to end; QA observations ruled follow-ups; roles-who-can-do-what cleared for 0.54.1 | SHIP WITH NOTES | 2026-11-02 |

## The bug (from the analyst's D1, verbatim summary in the inc3 addendum)

1. Send a visitor a sign-in invitation.
2. Archive the visitor. The dialog says "It will stop working."
3. The person signs in and presses "Accept the invitation". The page answers "This invitation can't be completed. Contact <congregation>'s office.", and the invitation is blocked with reason `membership_ended`.
4. Restore the person.

**Result:** the record's Sign in card and the list row still say "This invitation couldn't be completed because … connection to … has ended." The card has no button and the record is live again, so the person can never be invited from the product. Changing the email does not clear it.

**Contrast:** if the person never opens the link, archive then restore leaves the invitation open and working.

**Second symptom:** while archived, the person is offered "Accept the invitation" and learns only after pressing it that it cannot work. The administrator's archived record still says "While this invitation is open…".

The bug is 3a's: Restore is new in 3a. Before it, an ended connection never came back, so a terminal block was correct.

**Analyst's suggested fix:** Archive revokes the open invitation, as its dialog promises, so the person sees the dead-link page and Restore leaves the card on "Invite". Alternatively, derive the `membership_ended` card from current membership state rather than the stored block.

---

# Phase 2 — Architectural review: SKIPPED (tech-lead, 2026-11-02)

Skipping Phase 2: no migration, no `SECURITY DEFINER` change (the fix calls the existing `presby_revoke_sign_in_invitation`), no new dependency, no new route, action, permission key, flag or audit key, and no change to any boundary the 2b architect set. The 2b B2 rule ("`org-invite.ts` is the only file that names the five sign-in definers and is imported only from `src/app/(org)/`", `src/lib/onboarding/boundaries.test.ts:495-545`) is kept as it stands: the archive writer does not import `org-invite.ts`; the server action, which is under `(org)`, hands it a function (see the API Contract). If Phase 4 finds it cannot keep that, stop and return to Phase 2.

# Phase 3 — Technical Design (tech-lead, 2026-11-02)

## Root cause (with file:line)

D1 is two facts that were each correct when written and are wrong together, because 3a made an ended connection reversible.

1. **Archive ends the membership and leaves the person's open sign-in invitation alone.** `archivePerson` (`src/lib/community-engagement.ts:341-421`) updates `memberships.ended_on` (`:388-397`) and writes the `tenant.person.archived` row (`:405-415`). It never reads or touches `account_invitations`. The dialog line "An invitation to {name} is still open. It will stop working." (`src/app/(org)/o/[slug]/admin/community/engagement-copy.ts:299`) was a promise nothing kept: the link stayed open and live, and "stops working" was true only in the sense that pressing Accept would fail.
2. **Acceptance then closes the row for good, with a reason about a state that can change.** An archived person's preview still returns the row (`presby_preview_invitation` filters on the row's own five timestamps and the address, `drizzle/0065_presby_sign_in_and_connect.sql:2281-2330`, not on membership), so the page offers "Accept the invitation". Pressing it runs the acceptance core, whose sign-in branch calls `presby__person_sign_in_standing` (`drizzle/0066_presby_membership_standing.sql:653-728`); `membership_ended` is its refusal for `not v_has_m or v_m.ended_on is not null` (`:684`), and the core stamps `blocked_at` and `blocked_reason = 'membership_ended'` on the row. `presby_account_invitations_guard_update` makes a blocked row terminal (`drizzle/0065_...sql:2397-2430`: "invitation % is finished; only redaction may follow").
3. **The reader keeps showing the stored block.** `presby_sign_in_invitation_states` (`drizzle/0065_...sql:1364`) returns the newest non-superseded terminal row, so state `blocked`, outcome `membership_ended`. `readStates` (`src/lib/onboarding/org-invite.ts:268-310`) passes it through; `blockedCardLine` (`src/lib/onboarding/sign-in-copy.ts:152-154`) prints "...connection ... has ended"; the card renders no button for `blocked` (`.../[id]/edit/sign-in-card.tsx:146-147`); `connectOutlook` returns `none` (`sign-in-types.ts:208`); the list marker is "Invitation couldn't be completed" (`sign-in-types.ts:302-303`). Restore (`community-engagement.ts:446-519`) clears `ended_on`, touches no invitation, and nothing in the reader asks whether the connection still has ended. A send over a blocked row would work (`presby_issue_sign_in_invitation` refuses only an open row, `already_pending`), but no button offers it, and a changed email address does not matter because the stored row, not the address, decides the card.

A second path into the same state exists today and predates 3a: voiding an "other participant removed" roll action reopens the membership (`drizzle/0061_presby_participant_roll.sql:556-572`, `update memberships set ended_on = null`). A person whose removal was undone after they pressed Accept on an open invitation lands in the same dead end. Read from the code; the DB test below pins it.

## Summary

Rule **both**, for different reasons.

- **(a) Archive revokes the person's open sign-in invitation in the same transaction, with an audit row.** This makes the dialog's promise true, gives the archived person the neutral dead-link page instead of an "Accept the invitation" button that cannot work (second symptom, both halves), and keeps a link emailed before the archive from coming back to life on Restore. It is the fix that stops new bad rows.
- **(b) The reader treats a stored `membership_ended` block as stale when the membership is live now.** It is the backstop for every row already blocked, and for the participant-removal-then-void path, which (a) does not reach. A stored block records "ended when you pressed Accept"; once the connection is live again it says nothing about today, so the reader reports state `none`.

(a) alone leaves already-blocked rows and the void path stuck. (b) alone leaves the archived person being offered a button that cannot work, and an emailed link that revives on Restore. Both are small and neither touches the schema.

**Restore does nothing about invitations.** An archive-revoked invitation stays revoked, so Restore never re-arms a link that was emailed days ago; the administrator sends a new one on purpose (the card offers "Send invitation" again). No change to `restorePerson`.

**No migration. No `SECURITY DEFINER` change. Phase 2 skipped (above).**

## Decisions on the points you asked me to weigh

**Existing data.** Counted read-only against production (`br-wild-band-ax96gv09`, a `default_transaction_read_only=on` session, 2026-11-02): migrations 0065 and 0066 are both applied there; `account_invitations` rows with `purpose = 'sign_in'`: **0**; of those, blocked `membership_ended`: **0**; memberships with `ended_reason = 'community_archived'`: **0**. So no production row is in the stuck state and none can be created by this bug before the fix ships. Throwaway dev and pipeline branches may hold some (the analyst's walk branch does); (b) clears them on read and they need no migration or cleanup. For a future operator check:
`select count(*) from account_invitations i where i.purpose='sign_in' and i.blocked_reason='membership_ended' and exists (select 1 from memberships m where m.person_id=i.person_id and m.organization_id=i.organization_id and m.ended_on is null);`

**What an already-blocked row shows after Restore.** State `none`: the card reads "Invite {name} to sign in. We'll email {address} ..." with "Send invitation", the list marker is the ordinary `not_connected` one, and no "couldn't be completed" line. The stored row is untouched (terminal, immutable); only the reader's answer changes. Only `blocked` + `membership_ended` + a live membership is reinterpreted. `person_merged`, `person_deceased`, `needs_support` and every other row state are unchanged, and a blocked `membership_ended` row on a person who is still ended stays blocked (the card still tells the administrator the truth).

**Audit action.** Reuse `invitation.revoked` (`AUDIT_ACTIONS.INVITATION_REVOKED`), `resourceType: "account_invitation"`, `resourceId` the invitation id, actor the archiving administrator, metadata `{ invitationId, organizationId, purpose: "sign_in", origin: "org", personId, via: "archive" }`. `via` already takes `"single"` and `"revoke_all"` (`src/lib/onboarding/issue.ts:893`, `org-invite.ts:522`); `"archive"` is a third value and nothing switches on it (grepped: only tests read `via`). No new key: a detection query for "who cancelled invitations" keeps working. The `tenant.person.archived` row gains one boolean, `invitationRevoked`, beside the existing `signInConnected` (the e2e and DB tests use `toMatchObject`, so this breaks nothing; `src/lib/audit.ts:687` comment updated).

**What the archived person sees on opening a revoked link.** The one dead-link page, "This link isn't active" with `INVITATION_DEAD_LINK_COPY` (`src/lib/onboarding/labels.ts:135`), because the preview returns zero rows for a revoked row (`presby_preview_invitation` filter, `drizzle/0065_...sql:2310-2314`). It names no congregation and no reason (DECISION-147: the bucket distinguishes nothing), so it does not tell a former visitor they were archived. Accepted residual, `paper`: its sentence "ask whoever invited you to send a new one" is generic and an archived person's inviter cannot send one until the record is restored. The bucket is deliberately uninformative; I do not change it.

**Restore.** Nothing. Reasoned above.

**Dialog copy.** "It will stop working." is now true, and becomes true in the way the administrator cares about; one clause is added so Restore does not surprise (see Copy).

## Permissions & Flags

- Permission key(s): none new. Archive keeps `people.manage` (`community-engagement.ts:55`); the revoke definer checks `people.manage` again for the acting user (`presby__actor_person(..., 'people.manage')`, `drizzle/0065_...sql:1303-1306`), which the archiving administrator holds by construction. Cancelling is never an escalation.
- Default role bindings: none.
- Feature flag(s): not needed. The archive action is already behind the Community flag (`org_portal.members_create`); (b) changes what an existing reader reports.

## API Contract

No route. No new server action. Signatures that change:

1. `src/lib/onboarding/org-invite.ts` (the only file naming the definer; no new importer):
   `export async function revokeOpenSignInInvitationInTx(tx: OrgTx, ctx: SignInContext, personId: string, via: "archive"): Promise<boolean>`
   Runs `presby_revoke_sign_in_invitation(personId, ctx.actingUserId)` in the caller's transaction. `not_open` returns `false` and writes nothing. `ok` cancels a still-queued email with `cancelQueuedEmail` (same helper `revokeSignInInvitation` uses), writes the `invitation.revoked` row with `insertAuditRow(tx, ...)` and returns `true`. Any other outcome, and any throw, propagates so the whole archive rolls back. `revokeSignInInvitation` is refactored to call the same inner function with `via: "single"`; its behaviour and results do not change.
2. `src/lib/community-engagement.ts`: `archivePerson(viewerPersonId, organizationId, input, actor, sideEffects)` gains a **required** fifth parameter
   `type ArchiveSideEffects = { revokeOpenSignInInvitation: (tx: OrgTx, personId: string) => Promise<boolean> }`.
   Required so that a caller that forgets it is a type error, not a silent regression. It is called inside the same `withOrgContext` transaction, after the membership `update` succeeds and before the audit insert, so a throw (including the audit insert's) rolls back archive and revoke together. Result type adds `invitationRevoked: boolean` to the `ok` arm; the audit row records it. `archivePerson` does not import `org-invite.ts`, so 2b B2 holds and `membership-standing.source.test.ts`'s writer pins are untouched.
3. `src/app/(org)/o/[slug]/admin/community/actions.ts` `archivePersonAction` (signature unchanged for callers): builds `{ revokeOpenSignInInvitation: (tx, personId) => revokeOpenSignInInvitationInTx(tx, { organizationId: g.organizationId, actingPersonId: g.viewerPersonId, actingUserId: g.actor.userId, actingUserEmail: g.actor.email ?? null }, personId, "archive") }` and passes it. A throw already maps to `ARCHIVE_COPY.db_error` (`actions.ts:182-186`).
4. `readStates` (`src/lib/onboarding/org-invite.ts:268`): after mapping rows, for the `!linked`, `state === "blocked"`, `outcome === "membership_ended"` rows only, one extra query in the same transaction, `select m.person_id::text from memberships m where m.organization_id = <ctx org> and m.person_id = any(<ids>) and m.ended_on is null` (RLS-scoped; own-organization fact; `ended_on is null` is exactly the core's own `membership_ended` test at `0066:684`, not a restatement of standing). A hit is rewritten to the `none` shape: `state: "none"`, `outcome: null`, `sentAt/expiresAt/nextResendAt/invitedAddress/addressCurrent: null`, `resendCount: 0`, `delivery: deliveryState(null)`. This is the single choke point, so the card (`getSignInCard`), the list markers (`getSignInMarkers`), the Session hand-off rows (`listSessionSignInRows`) and the after-send state at `:430` all agree. Zero extra queries when no row is `blocked`/`membership_ended`.

Lock order, for the record: archive locks the membership row (`for update of m`) and then the definer takes the organization row `for update`; acceptance takes organization, invitation, user, person and contact, and only reads the membership (`0065:1883-1895`, `0066:684`), so there is no cycle. This is reasoned from the definers; a two-connection test pins the observable result (see Tests) and the claim is **unverified under real concurrency until that test runs**.

## Data Model

No schema changes required. No migration (0085 stays free). No `SECURITY DEFINER` function is created, replaced or dropped. Feasibility check against the live tree: `presby_revoke_sign_in_invitation(uuid, uuid)` exists with that signature (`0065:1295`), is callable by `presby_app` from inside `withOrgContext` (it is how `revokeSignInInvitation` already calls it), and `account_invitations` is not touched from TypeScript (a boundaries test bars it from `org-invite.ts`); no CHECK, trigger or FK is added, so nothing in `scripts/seed-dev.sql` is validated anew.

## Component / Page Plan

- Pages to create: none. Components to create: none.
- Files to modify:
  - `src/lib/onboarding/org-invite.ts`: `revokeOpenSignInInvitationInTx`, the shared inner revoke, the `readStates` rewrite.
  - `src/lib/community-engagement.ts`: fifth parameter, the call, `invitationRevoked` in the result and the audit metadata; header comment states the archive-revokes rule.
  - `src/app/(org)/o/[slug]/admin/community/actions.ts`: builds and passes `sideEffects`.
  - `src/app/(org)/o/[slug]/admin/community/engagement-copy.ts:299`: the one dialog line.
  - `src/lib/audit.ts:~687`: comment lists `invitationRevoked` (archived) and `via: "archive"` (revoked).
  - `src/lib/onboarding/issue.ts:893`: widen the `via` union only if `revokeRow` is reused (it is not: this path is `presby_app`, not the platform connection), so likely unchanged; leave it unless a type needs it.
  - Existing tests that call `archivePerson` (list under Tests) take the new parameter.
  - Help: `src/content/help/adding-people.md` (`:59`, `:63`) and `src/content/help/sign-in-invitations.md` (`:24`, `:28`, `:32`).
- Files not touched on purpose: `restorePerson`, `sign-in-copy.ts`, `sign-in-card.tsx`, `labels.ts`, every `drizzle/` file, every Rule 16 shared file.

## Implementation Order

1. Write the regression test and the DB tests first and run them red against the unmodified tree (record the red output in Phase 4).
2. `revokeOpenSignInInvitationInTx` and the `revokeSignInInvitation` refactor (`org-invite.ts`); unit tests.
3. `archivePerson` fifth parameter, call, audit metadata; update every caller; unit and DB tests.
4. `archivePersonAction` wiring; action test.
5. `readStates` rewrite; unit and DB tests.
6. Dialog string and its four tests; help pages; `audit.ts` comment.
7. Audit events: none new keys (above). Release notes and the TODO/functionality-map housekeeping: orchestrator at ship (Rule 10/14 shared files); a bug fix, so no what's-new.

## Copy

One new or changed user-facing string, and two help edits. Nothing else in the product changes: the dead-link page, the card lines, the markers and the refusal sentences are used as they are.

| # | Where | Text |
|---|---|---|
| C1 | Archive dialog, extra line when an invitation is open (`engagement-copy.ts:299`) | "An invitation to {name} is still open. It will stop working, and restoring them will not turn it back on." (was: "...It will stop working.") |
| H1 | `adding-people.md:59` | after "...another if an invitation to them is still open." add: "Archiving cancels that invitation." |
| H2 | `adding-people.md:63` | after the Restore sentences add: "Restoring does not bring back an invitation that was open when they were archived. Open their record and choose "Send invitation" to send a new one." |
| H3 | `sign-in-invitations.md:24` | after the "Cancel invitation" bullet add a sentence in that bullet: "Archiving a person cancels an open invitation too, and restoring them does not turn it back on." |

The four checks, one line per group:

1. **Residuals.** C1/H1-H3 deny no accepted residual. The two this fix touches are admitted, not denied: the dead-link page's generic "ask whoever invited you" (above, `paper`) and the 2b accepted residual F232 (not touched). Nothing says an archived person is told why a link is dead.
2. **Source of truth.** C1's "is still open" is the existing `invitationOpen` fact (card state `pending`, `page.test.tsx:1078`), and "It will stop working" is now established by the revoke in the same transaction (DB test below); "restoring them will not turn it back on" is the terminal revoked row (`presby_account_invitations_guard_update`, `0065:2397-2430`), pinned by the regression test. It claims nothing about an expired-but-open row, which archive also revokes silently. H2's "Send invitation" is the card's own button (`SIGN_IN_CARD_COPY.buttons.send`, `sign-in-copy.ts:112`), which the card shows for state `none`/`revoked` when an address is on file; if there is no address the card says to add one, and H2 does not promise otherwise.
3. **Audience.** C1 is seen by whoever can open Archive: a `people.manage` holder (the action's gate, `community-engagement.ts:55`); "restoring them" and "send a new one" are both `people.manage` acts. H1-H3 are read by the same administrator audience as the pages (`audience: "administrator"`, `registry.ts:684-692`).
4. **Neighbours.** Grepped the live tree for invitation/archive/restore/"stop working" strings. Made stale by this change: `engagement-copy.ts:299` (C1), pinned exactly in `engagement-copy.test.ts:292,305`, `community-row-actions.test.tsx:175`, `.../[id]/edit/page.test.tsx:1085`; help `adding-people.md:59,63` and `sign-in-invitations.md:24` (above). Checked and still true: `sign-in-invitations.md:28` ("the person's connection to your congregation has ended" as a refusal reason is the send-time refusal, unchanged), `:32` and `:65` (the "Invitation couldn't be completed" marker still exists for the cases that stay blocked: merged, deceased, support), `CONNECT_OUTLOOK_COPY.pendingInvitation` (`sign-in-copy.ts:~190`, shown only while open), `SIGN_IN_DIALOG_COPY.cancel.body` (`:220`, the single-cancel dialog, unchanged), and `no-organization-copy.ts` (an archived person's own page; it does not mention invitations by their state).

## Help impact (Workflow Rule 17)

Both pages named by the analyst are touched, and nothing is retired or added.
- `adding-people` (H1, H2): archive cancels an open invitation; restore does not revive it. Its `labels` (registry `:434`) gain no new quoted string beyond "Send invitation", which `sign-in-invitations` already lists; add it to `adding-people`'s `labels` only if the implementer quotes it in a way `check:help` requires.
- `sign-in-invitations` (H3), and its `:28`, `:32`, `:65` read-through above (no edit). `verifiedIn` on neither page moves here: the analyst re-walks both after this ships (the live-walk addendum already says neither can move until D1 and the wording items are done).
- Phase 4 edits the pages from the screens (the dialog line, the record after archive and after restore), not from this table.

## Tests (named; regression test first, red before the fix)

**Regression test, must fail first**, in `src/lib/community-engagement.db.test.ts` (new `describe("F417: archive revokes an open sign-in invitation")`), using `createSignInFixture` (`src/lib/testing/sign-in-fixture.ts`): `D1: archive, the person presses Accept, restore, the card offers the invitation again`.
  1. a congregation with the connect toggle on, a sender holding `people.manage`, a visitor person with an address and a verified, active account on that address;
  2. issue a sign-in invitation (`fx.issue`);
  3. `archivePerson(..., sideEffects)` with the real `revokeOpenSignInInvitationInTx`;
  4. the person presses Accept: `fx.acceptInPlace` (the existing in-place acceptance path the no-organization page uses) **must return the dead outcome and the row must be `revoked`, not `blocked`**; the preview for the token returns zero rows;
  5. `restorePerson`;
  6. `getSignInCard` returns `state: "none"`, `blockedOutcome: null`; `getSignInMarkers` returns the ordinary `not_connected` marker; `sendSignInInvitation` returns `ok` and a new open row exists.
  Against the unmodified tree, step 4 returns `blocked` / `membership_ended` and step 6 returns `blocked`: red. (Run it before the fix, record the output, then fix.)

**Unit tests (mocked), `src/lib/community-engagement.test.ts`:** archive calls `revokeOpenSignInInvitation` once with the transaction and the person id, after the membership `update` and before the audit insert; it never calls it on `forbidden`, `not_found`, `self_target`, `already_ended`, `not_eligible`, `pending_action` or `holds_position`; `invitationRevoked` true/false reaches the result and the audit metadata; a throw from the side effect rejects and writes no audit row (extends the existing audit-throw test at `:424`). `src/lib/onboarding/org-invite.test.ts`: `revokeOpenSignInInvitationInTx` `ok` (cancels the queued email, one `invitation.revoked` row with `via: "archive"`, returns true), `not_open` (writes nothing, returns false), any other outcome throws; `readStates`: `blocked`/`membership_ended` with a live membership reports `none` through the card, the markers and the Session rows; with an ended membership it stays `blocked`; `person_merged` and `needs_support` stay `blocked`; no extra query when nothing is `blocked`/`membership_ended`; `revokeSignInInvitation`'s existing results are unchanged. `src/app/(org)/o/[slug]/admin/community/actions.test.ts`: `archivePersonAction` passes a `sideEffects` whose function receives the acting user from the session, never from input. `engagement-copy.test.ts:292,305`, `community-row-actions.test.tsx:175`, `.../[id]/edit/page.test.tsx:1085`: the new C1 string. `src/lib/onboarding/boundaries.test.ts`: unchanged and must stay green (it is the proof 2b B2 holds).

**DB tests (`describe.skipIf(!hasDb)`), `src/lib/community-engagement.db.test.ts` and `src/lib/onboarding/org-invite.db.test.ts`:**
  - archive of a person with an open invitation: row `revoked`, `revoked_by_user_id` the actor, an `invitation.revoked` audit row `via: "archive"`, a `tenant.person.archived` row with `invitationRevoked: true`; with no open row, `invitationRevoked: false` and no `invitation.revoked` row;
  - an expired-but-open row is revoked; a different person's open row, an accepted row and another organization's row are untouched;
  - a still-queued invitation email is cancelled and its stored body scrubbed;
  - **rollback**: a forced throw from the audit insert (the existing EC-16 harness, `:494`) leaves the invitation open and the membership live;
  - **race** (extends EC-8, `:544`): an acceptance and an archive on two connections end in exactly one of two consistent states (accepted and then archived with no revoke; or revoked and the acceptance `dead`), never blocked, never half-written;
  - **backstop (b), independent of (a)**: issue, end the membership by owner SQL with the archive marker (bypassing `archivePerson`), accept (the row becomes `blocked` / `membership_ended`), `restorePerson`, then the card is `none` and a send succeeds; and the participant path: a participant with an open invitation, removal, accept (blocked), void the removal, card `none`. If the participant fixture cannot reach it cheaply, the first scenario stands and the second is reported as unverified, not dropped silently.

**e2e (`e2e/community-engagement.spec.ts`, a new test 14, the file's own `COMMUNITY_FLAG = org_portal.members_create` set through `e2e/support/flags.ts` as the spec already does; no other flag, and `scripts/ci/e2e-baseline-flags.sql` is not touched):** seed an open sign-in invitation with a known token for an Inactive/visitor person (`seedSignInInvitation`), open Archive from the record and read the dialog line (C1), confirm; as that person (`signInAs` with a fixture account on the address) open `/invite?token=...` and see "This link isn't active"; as the administrator restore the person and see the record's Sign in card offer "Send invitation" with no "couldn't be completed" text; assert the two audit rows with `auditFor`. At 360 px for the dialog (no horizontal overflow, `noHorizontalOverflow`). The existing spec's test 5 (`:377`) asserts the archived/restored rows with `toMatchObject` and sees no invitation, so it should not need changes; the implementer confirms. No hydration spec changes (`e2e/hydration/community-engagement-controls.spec.ts` asserts button presence, not dialog text).

## e2e blast radius (existing specs this change can alter)

`e2e/community-engagement.spec.ts` tests 5 and 11 (Archive/Restore from lists and from the record; the dialog text with an open invitation is not asserted anywhere in `e2e/`, grepped), `e2e/hydration/community-engagement-controls.spec.ts` (Archive button only). `e2e/sign-in-connect-smoke.spec.ts` and `e2e/no-organization-connect.spec.ts` exercise acceptance and connect for people who are not archived: unchanged. The unit/DB blast radius is every existing call of `archivePerson` (new required parameter): `community-engagement.test.ts:118,145,329-424`, `community-engagement.db.test.ts` (the archive/restore, EC-16, EC-8 and G2 describes), `actions.test.ts:29` (mocked), plus `membership-standing.db.test.ts` if it archives.

## Edge Cases & Risks

- **A concurrent accept** (above): reasoned lock order, pinned by the race test; **unverified** until it runs.
- **An expired open row** is revoked, not left: harmless, pinned by the DB test above. The dialog makes no claim about it.
- **A person who is connected** (`people.user_id` set) has no open row to revoke (issue refuses `already_signs_in`); `invitationRevoked` is false. Pinned by the "no open row" DB case.
- **Revoke raises 42501** (the actor lost `people.manage` mid-request): the archive rolls back and the action returns its existing `db_error` copy; pinned by the unit throw test, not by a real revoked permission (**unverified** end to end).
- **The archived record's own Sign in card.** After (a), an archived person's card state is `revoked`, which renders "Invite {name} to sign in ..." with "Send invitation" and an outlook line. That is exactly what an archived person who was never invited already shows today (the card ignores an ended membership), and a send is refused with the existing truthful sentence ("This person's connection to {congregation} has ended, so they can't be invited"). I read this from the code and have not seen it in a browser; it is **not** fixed here (see Out of Scope). The analyst's second symptom, "While this invitation is open..." on the archived record, **is** fixed because the row is no longer open.
- **The participant-removal path**: (b) clears the dead end; (a) does not apply, so a removed participant with an open invitation can still press Accept after removal and be blocked. Not changed here (see Out of Scope).
- **Phone width**: the only visible change is one more sentence in the existing dialog line; it wraps like the line it extends (a long name: the existing `engagement-copy` tests and the 360 px e2e assertion above; the wrap itself is **unverified** until Phase 4 looks at it).

## Out of Scope (explicit non-goals, for the operator to confirm)

1. Changing the dead-link page's wording or making it say why (DECISION-147).
2. Revoking at participant removal, or at any other path that ends a membership. Every other ended membership is terminal except the void of a participant removal, which (b) now handles on the card.
3. Hiding or rewording the Sign in card on an archived record (the "Send invitation" offer on an archived person, above). Proposed as a TODO line for the analyst's Phase 6 to judge, with the unverified-in-browser caveat.
4. Making Restore re-open a revoked invitation.
5. A cleanup of existing `blocked` rows. (b) is a read, nothing is rewritten; production has none.
6. The analyst's N1-N4 and the other TODO items in the live-walk addendum.

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| D1: archive, Accept, restore leaves a permanent dead end (card "ended", no button, list marker, email change does not clear it) | Root cause and both fixes: Summary; API Contract 1, 2, 4; regression test and (b) backstop test in Tests. |
| D1 second symptom, the person is offered "Accept the invitation" while archived | (a): the revoke makes the preview return zero rows, so the dead-link page shows (Decisions, "What the archived person sees"); e2e step 3. |
| D1 second symptom, the archived record still says "While this invitation is open..." | (a): the row is no longer open. Pinned by the regression test's `getSignInCard` read after archive in step 4 (assert `state: "revoked"` there too). |
| Analyst's contrast case (never opened the link, archive then restore leaves it working) | **Changed on purpose**: the link now stops at archive and Restore leaves it stopped, as the dialog says (C1). Stated in the release note as a behaviour change, not a regression. |
| Analyst: "Restore must never leave a terminal 'connection has ended' card or list marker" | (b), all three readers via `readStates`; Tests (card, markers, Session rows). |
| Analyst's help note: D1 touches the `sign-in-invitations` "invitations" section | Help impact H3, `adding-people` H1, H2. `verifiedIn` is not moved by this pipeline; the analyst re-walks. |
| Phase 2 rulings | None: Phase 2 never ran on this fix. The standing 2b B2 and F232 rulings are preserved (Summary, Copy check 1). |
| Analyst N1-N4, follow-ups 2-6 | *Deferred*: separate TODO lines already filed from the addendum; not this pipeline. |

## DECISION-315 (draft for the orchestrator to add to `docs/decisions.md` at integration; shared file, not edited here)

**DECISION-315 — Archive revokes an open sign-in invitation; the reader never reports a stored `membership_ended` block over a live membership.**
Archiving a person (Community, 3a) revokes their open sign-in invitation in the archive's own transaction, through the existing `presby_revoke_sign_in_invitation`, audited as `invitation.revoked` with `via: "archive"`; the `tenant.person.archived` row carries `invitationRevoked`. Restore does nothing to invitations: a revoked link stays revoked and the administrator sends a new one. Separately, `readStates` reports state `none` for a `blocked`/`membership_ended` row whose membership has `ended_on is null`, so Restore (3a) and the voiding of a participant removal (0061) never leave a card on "has ended". `archivePerson` receives the revoke as a required function argument from its `(org)` caller so `org-invite.ts` keeps being imported only from the tenant portal (2b B2). Why: 3a made an ended connection reversible, which made a terminal block about a point-in-time state wrong. No migration, no definer change. Accepted, `paper`: the dead-link page's generic "ask whoever invited you" reaches an archived person whose inviter cannot send until Restore; the archived record's Sign in card still offers "Send invitation" and the send is refused with the existing sentence (not changed here).

## Implementer

**full-stack-developer.** The change spans one library module, one tenant-side action, one reader, one dialog string and help copy; it is small and tightly coupled (the new parameter, the action that supplies it, the reader and their tests move together), so splitting between api-developer and ux-developer adds overhead. No schema, so database-admin is not needed.

## Phase 5 scope (for QA)

1. Run the regression test **against the unmodified tree first** (from a scratch copy or a WIP commit; no `git stash` in worktrees) and record that it fails at step 4 and at step 6; then against the fix and record that it passes.
2. Unit, DB and e2e suites named above; `npm run check` (all ten tripwires; `check:audit` and `check:help` included); `src/lib/onboarding/boundaries.test.ts` green unchanged; typecheck and build.
3. Feature-gate audit: `archivePersonAction` still gated by session, `people.manage` and the Community flag; no new action or route; no `getPlatformDb()` introduced under `(org)`.
4. Copy-truthfulness on the diff: C1 against the revoke, H1-H3 against the screens at 360 px (the Archive dialog with an open invitation, the record after archive, the record after restore, the dead-link page for the archived person's link).
5. Verify the "unverified" items above actually ran: the race test, the participant-removal path, and the dialog wrap at 360 px; anything that could not run is reported as such, not as a pass.
6. Not auth-touching (`src/auth.ts`, `src/proxy.ts`, `(auth)`, `src/lib/auth/` are not edited), so the MFA-login e2e gate does not apply; the new e2e still signs in as a seeded account.
7. Phase 6 (analyst): re-walk the D1 sequence on the record and the list, and the six pages the addendum left open, `adding-people` and `sign-in-invitations` included.

---

# Phase 4 — Implementation (full-stack-developer)

**Date:** 2026-11-02. Bug-fix variant. Scratch server on port 3580 from a copy outside the platform folder; flags reset first with `e2e-reset-flags.sql`.

## Red, then green

The regression test is `D1: archive, the person presses Accept, restore, the card offers the invitation again — regression for F417` in `src/lib/community-engagement.db.test.ts` (new `describe("F417: ...")`, on `createSignInFixture`). Its assertions are `expect.soft`, so the red run lists every failing step. **Run against the unmodified tree** (the test written first, before any source edit; `npx dotenv -e .env.local -- npx vitest run --no-file-parallelism src/lib/community-engagement.db.test.ts -t F417`): 1 failed, 8 soft failures, in D1 order:

- archive result: `invitationRevoked: true` expected, absent;
- card after archive: expected `state: "revoked"`, got `"pending"` (the second symptom, "While this invitation is open");
- preview of the token: expected 0 rows, got 1 (the archived person is offered Accept);
- Accept (`presby_accept_in_place`): expected `outcome: "dead"`, got `outcome: "blocked"`, `blocked_reason: "membership_ended"`;
- the row: expected `blocked_at: null`, `revoked_by: <sender>`; got `blocked_at` set, `blocked_reason: "membership_ended"`, `revoked_by: null`;
- after Restore, card: expected `state: "revoked"`, got `state: "blocked"`, `blockedOutcome: "membership_ended"` (the D1 dead end);
- marker: expected none, got `{ kind: "blocked" }`;
- `sendSignInInvitation` and the open-row count: not reached by the old code as a fix (the send itself would work; the card offered no button).

Full output kept in the scratchpad (`red.txt`). **After the fix**: the same test passes (`community-engagement.db.test.ts`: 45 passed, serial, against the pipeline branch).

The e2e test 14 was run only with the fix (52 passed with its neighbours); it was not run red on the unmodified tree, because that needs a second server on unmodified source. The DB regression test is the red-first evidence.

## Files Modified

- `src/lib/onboarding/org-invite.ts`: `revokeInTx` (shared inner revoke: definer, `cancelQueuedEmail`, `invitation.revoked` audit row with `via`), exported `revokeOpenSignInInvitationInTx(tx, ctx, personId, "archive"): Promise<boolean>`, `revokeSignInInvitation` refactored onto `revokeInTx` with `via: "single"` (results unchanged), and `reinterpretEndedBlocks`, called at the end of `readStates` (one extra query on `memberships ... ended_on is null`, only when a `blocked`/`membership_ended` row is present, rewriting it to the `none` shape).
- `src/lib/community-engagement.ts`: `ArchiveSideEffects`; `archivePerson` takes it as a required fifth parameter, calls it after the membership update and before the audit insert; `invitationRevoked` in the result and in the `tenant.person.archived` metadata. No import of `org-invite.ts`.
- `src/app/(org)/o/[slug]/admin/community/actions.ts`: `archivePersonAction` builds the side effect from the session's actor and the resolved organization.
- `.../engagement-copy.ts`: C1.
- `src/lib/audit.ts`: comments only (`invitationRevoked`, `via: 'archive'`).
- `src/content/help/adding-people.md` (H1, H2), `src/content/help/sign-in-invitations.md` (H3). `verifiedIn` not moved.
- Tests: `src/lib/community-engagement.db.test.ts`, `src/lib/community-engagement.test.ts`, `src/lib/onboarding/org-invite.test.ts`, `src/lib/onboarding/org-invite.db.test.ts`, `.../community/actions.test.ts`, `.../community/engagement-copy.test.ts`, `.../community/community-row-actions.test.tsx`, `.../[id]/edit/page.test.tsx` (the four pinned C1 strings), `e2e/community-engagement.spec.ts` (test 14).

## Schema Changes

None. No migration, no definer change, no new env var or `FEATURES` entry, no new audit key (`invitation.revoked` gains the metadata value `via: "archive"`).

## Audit Events

`invitation.revoked` (`via: "archive"`, actor the archiving administrator, same transaction); `tenant.person.archived` gains `invitationRevoked`.

## Tests added

- Unit `community-engagement.test.ts`: revoke called once with the tx and person id, order update, revoke, audit; `invitationRevoked` true/false in result and audit; never called on forbidden, not_found (both forms), self_target, already_ended, not_eligible (both forms), pending_action, holds_position; a revoke throw rejects and writes no audit; an audit throw after a revoke rejects.
- Unit `org-invite.test.ts`: `revokeOpenSignInInvitationInTx` ok / no queued email / not_open / unknown outcome / no row / 42501 / audit throw / invalid context; the reader backstop through the card, markers and Session rows (live membership reads none, ended stays blocked, merged/deceased/support stay blocked, no extra query when nothing is `membership_ended`, one query for many rows, scoped to the organization).
- Unit `actions.test.ts`: the side effect is bound to the session actor and resolved org, never to input.
- DB `community-engagement.db.test.ts` (F417 describe, 12 tests): the regression; archive with an open invitation (row revoked by the actor, `invitation.revoked` via archive, `invitationRevoked: true`); no open row (false, no revoked row); expired-but-open revoked while another person's open, an accepted and another organization's row are untouched; queued email cancelled and body scrubbed; rollback on a forced throw from the archive's own audit row after the revoke's row was written (invitation still open, membership live, link still previews); rollback on a revoke throw; race, both orders (below); backstop (b) with no revoke (archive marker, Accept blocks, Restore, card `none`, send succeeds, old row still terminal; a still-ended membership stays blocked; a merged person stays blocked). `NO_INVITATION` (a revoke that finds nothing) added to the existing archive calls in that file, whose viewer has no linked account.
- DB `org-invite.db.test.ts` (3 tests): `revokeOpenSignInInvitationInTx` in a real transaction (revoke, cancel, scrub, audit via archive, second call false and writes nothing), another person's row untouched and `revokeSignInInvitation` still audits via `single`, an actor without `people.manage` refused by the definer.
- Race, both orders (held organization-row lock on the owner connection, calls queued in a known order): the acceptance first gives `accepted`, then the archive finds nothing open (`invitationRevoked: false`); the archive first gives revoked and the acceptance `dead`, never `blocked`. The design's "unverified under real concurrency" item is now run; these pin the observable result of the lock order, not a free-running interleaving.
- e2e `community-engagement.spec.ts` test 14 (both viewports, 360px included): C1 in the dialog, `expectDialogFits`, `noHorizontalOverflow`, confirm; invitation row revoked and not blocked; `invitation.revoked` (via archive, actor the sender) and `tenant.person.archived` (`invitationRevoked: true`); the person's own session at `/no-organization` shows no "Accept the invitation" button and `/invite?token=...` is the dead-link page; Restore, then the Sign in card reads "Invite {name} to sign in." with "Send invitation" and neither "couldn't be completed" nor "has ended".

## Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass, 0 warnings |
| `npm run check` | all ten tripwires pass (audit, sql-date, deps-drift, brand-scope, secrets, hydration-gate, giving-boundaries, treasury-boundaries, proxy-imports, help) |
| `npm test` (no DB env) | 833 files passed, 140 skipped; 13247 tests passed, 3786 skipped (the DB-backed suites skip without `.env.local`); `onboarding/boundaries.test.ts` unchanged and green |
| DB, serial, pipeline branch | `community-engagement.db.test.ts` 45 passed; `onboarding/org-invite.db.test.ts` 31 passed; neighbours `membership-standing.db`, `community.db`, `sign-in-invitations.db`, `sign-in-accept.db`: 172 passed |
| e2e, own server on 3580, flags reset first | `community-engagement.spec.ts` (28 incl. new 14 at both widths), `community-sign-in-invite.spec.ts` (20), `hydration/community-engagement-controls.spec.ts`: 52 passed |
| 360px archive dialog, light and dark | a 53-character unbroken surname aside, the dialog fits (x 16, width 328, no page overflow, buttons inside); the new sentence wraps like the line it extends; screenshots read in both schemes |

`npm run build` was not run (not in the requested gates).

## Departures and findings

1. **The design's regression step 6 and marker assertion were adjusted to the code.** The design said the card is `none` and the marker `not_connected` after archive-revoke then Restore. A revoked row reads `revoked` (the design's own Carry-forward says so) and the card then renders the "Invite..." text with "Send invitation"; a plain visitor with no inert authority has no marker at all (`deriveSignInMarker`). The test asserts `state: "revoked"`, `blockedOutcome: null`, no marker, a successful send and one open row. `none` is asserted where it applies, in the (b) backstop tests.
2. **The participant-removal path was simulated, not driven through `presby_void_roll_action`.** The (b) test ends the membership with `other_participant_removed` on the owner path, presses Accept (blocked), then reopens it by owner SQL. The reader looks only at `ended_on`, so it exercises the same branch, but the real void function was not run: report as unverified through the real void. The Session-rows backstop is covered by the unit test only (an open Session seat prevents ending the membership, so the DB state is unreachable).
3. Regression assertions use `expect.soft` so the red run lists every step; this stays in the committed test.
4. `issue.ts:893` (`via` union) untouched, as the design predicted.
5. **Pre-existing, not caused or fixed here:** with a 53-character unbroken surname at 360px the archive dialog's title, first body line, the new line and its buttons clip at the right edge (the title and the unchanged "will leave the ... list" line clip the same way). Page overflow stays 0. Suggest a TODO line for the orchestrator (long unbroken names in the Archive/Restore dialogs).
6. **Confirmed from a browser** (it was "read from the code" in the design): the archived record's Sign in card reads "Invite {name} to sign in..." with "Send invitation" and the "When {name} signs in..." line; a send there is refused with the existing sentence. Not changed (Out of Scope 3). Screenshots in the scratchpad (`f417shots/`).
7. DECISION-315 text is in this log's Phase 3; not added to `docs/decisions.md` (Rule 16).

Strings changed: `engagement-copy.ts:299` (C1); `engagement-copy.test.ts:292,305`, `community-row-actions.test.tsx:175`, `.../[id]/edit/page.test.tsx:1085`; help `adding-people.md` (H1, H2), `sign-in-invitations.md` (H3). `check:help` passes.

## For QA

1. Re-run the regression test on a copy of the pre-fix tree (`git show 054b3ebd:...` sources) to see the eight soft failures; then on the fix.
2. `npx dotenv -e .env.local -- npx vitest run --no-file-parallelism src/lib/community-engagement.db.test.ts src/lib/onboarding/org-invite.db.test.ts` (the race tests count `Lock` waiters in `pg_stat_activity`: run on the pipeline branch with nothing else active).
3. e2e from a scratch copy outside the platform folder, `E2E_BASE_URL` on a port of your own: `community-engagement.spec.ts` (test 14), `community-sign-in-invite.spec.ts`, the hydration spec. The dev server also needs `CRON_SECRET`, the three `DOMAINS_*` fakes and `E2E_ALLOW_SHARED_DB=true`.
4. Copy-truthfulness at 360px: C1 in the dialog, the archived record, the restored record, the dead-link page for the archived person's link, against H1-H3.
5. Items not run: the real participant-removal void (departure 2); a revoke that raises 42501 mid-request end to end (unit-pinned only); e2e test 14 on the pre-fix tree.
6. `boundaries.test.ts` (2b B2) green unchanged; `archivePerson` is still gated by session, `people.manage` and the Community flag; no route, action or `getPlatformDb()` added.
7. Phase 6: re-walk D1 on the record and the list; the Archive dialog's long-name clipping (departure 5) is pre-existing.

---

## Phase 5 — Verification (qa)

**Date:** 2026-11-02
**Verified by:** qa
**Tree:** worktree `presby-archive-invite`, branch `pipeline/archive-revokes-invite`, HEAD `ba128d8c`. Pre-fix tree: `d530c41f` (the parent of `ad98b832`, equal to `origin/main`).
**Database:** Neon `pipeline-archive-revokes-invite`. All three connection strings in `.env.local` share one endpoint, and it differs from the main checkout's `development` endpoint. I compared hashed host labels and printed no value.
**Disk:** `/System/Volumes/Data` had 556 GiB free.

**Scope run:**
- Typecheck, lint, `npm run check` (all ten tripwires) and the full unit suite, all run in the worktree.
- Two touched DB suites plus seven neighbours, run serially.
- Production build in a scratch copy.
- e2e in both lanes from scratch copies outside `~/git/presby-platform/` (the dev lane on 3600, the prod lane on 3830), with a private `PLAYWRIGHT_BROWSERS_PATH`.
- A 360px browser walk in light and dark.

**Not re-run:**
- the full DB-backed set (the diff touches no migration, `authz.ts`, `src/lib/db/` or shared fixture);
- the full chromium e2e suite (the diff touches no proxy, auth, layout, `e2e/support/`, Playwright config or shared component);
- `test-rls.sql` (no schema change).

The PR's CI covers those.

**Flag state:** before any e2e run I reset global flags to the CI baseline with `psql "$PLATFORM_DATABASE_URL" -v ON_ERROR_STOP=1 -v pipeline_branch=1 -f scripts/ci/e2e-reset-flags.sql`, which committed with 10 baseline flags on. After all runs, `org_portal.members_create` and `org_portal.members_roll_action_edit` were back to `f` and `auth.require_2fa` was `t`.

**Env:** the dev and prod servers got `RATE_LIMIT_DISABLED=true`, `CRON_SECRET` and the three `DOMAINS_*` fakes. I did not set `E2E_ALLOW_SHARED_DB`: outside CI the guard only warns, so it was not needed.

**Housekeeping:**
- Every server was stopped by PID (3600 and 3830 are free).
- Worktree `git status` is clean and HEAD is unchanged.
- I edited no project file and authored no project test. The browser-walk driver lived only in the scratch copies.

## Type Check

`npm run typecheck`: **PASS**
`npm run lint`: **PASS** (0 warnings)
`npm run check`: **PASS**, all ten tripwires:
- audit
- sql-date
- deps-drift
- brand-scope
- secrets
- hydration-gate
- giving-boundaries
- treasury-boundaries
- proxy-imports
- help ("29 registry entries, 24 published, 24 content files, 7 images")

## Unit Tests

`npm test` (no DB env): **833 files passed, 140 skipped; 13247 tests passed, 3786 skipped; 39.6s. 0 failed.** These counts match Phase 4 exactly.
- The 140 skipped files are the DB-gated suites (`describe.skipIf(!hasDb)`). Their relevant members ran separately below; this is not an unreported skip.
- `src/lib/onboarding/boundaries.test.ts` (2b B2) is green and unchanged in the diff.

**DB-backed, serial (`--no-file-parallelism`), pipeline branch:**

| Run | Files | Result |
|---|---|---|
| Touched | `src/lib/community-engagement.db.test.ts`, `src/lib/onboarding/org-invite.db.test.ts` | **76 passed / 76**. Includes the F417 describe (12) and both race orders. |
| Neighbours | `membership-standing.db`, `community.db`, `db/domain/sign-in-invitations.db`, `db/domain/sign-in-accept.db`, `onboarding/accept-in-place.lib.db`, `db/domain/participant-roll.db`, `db/domain/sign-in-standing.db` | **269 passed / 269** across 7 files |

**Regression test, red then green (Bug-fix variant):**
- **Red.** I copied HEAD's `src/lib/community-engagement.db.test.ts` into an export of `d530c41f` and ran `-t "D1: archive"`. It failed with **8 soft failures**, in D1 order:
  1. archive result: `invitationRevoked` absent;
  2. card after archive: `state: "pending"` (the "While this invitation is open" symptom);
  3. token preview: 1 row, so Accept is still offered;
  4. Accept: `outcome: "blocked"`, `blocked_reason: "membership_ended"`;
  5. row: blocked, not revoked;
  6. `revoked_at`: null;
  7. card after Restore: `state: "blocked"`, `blockedOutcome: "membership_ended"` (the dead end);
  8. marker: `{ kind: "blocked" }`.

  This matches Phase 4's red record. The pre-fix `archivePerson` ignores the fifth argument, so the test ran there unmodified.
- **Green.** The same test passes at HEAD.

## End-to-End Tests

| Lane | Server | Specs | Result |
|---|---|---|---|
| Dev | `next dev -p 3600`, scratch copy of HEAD | `community-engagement.spec.ts` (incl. test 14), `community-sign-in-invite.spec.ts`, `hydration/community-{engagement,sign-in,approval}-controls.spec.ts`, `hydration/community-participant-dialogs.spec.ts` | **56 passed, 0 failed, 0 skipped (9.2m)**. Test 14 passed at desktop (#14) and at 360px (#28). |
| Prod (`npm run test:e2e:prod`, `PW_PROD_PORT=3830`) | the config's own `next build && next start` | the four community hydration specs | **6 passed, 0 failed (55.5s)** |
| Prod build, test 14 + sign-in-invite, run 1 | manual `next start -p 3830` on the scratch build | `community-engagement.spec.ts`, `community-sign-in-invite.spec.ts` | 40 passed, 10 failed (13.4m). **All 28 `community-engagement` tests passed, test 14 at both widths.** The 10 failures were all real-dialog sends in `community-sign-in-invite` (lanes 1, 2, 4, 4b, 10 × 2 widths): the dialog showed "We can't send invitations right now." Environmental, see below. |
| Prod build, run 2 | rebuilt with `NEXT_PUBLIC_APP_URL=https://localhost:3830`, `next start -p 3830` | `community-sign-in-invite.spec.ts` | **22 passed, 0 failed (3.1m)** |

**Why run 1 failed:**
- `platformOrigin()` (`src/lib/domains/host.ts:189-207`) returns `null` under `NODE_ENV=production` unless `NEXT_PUBLIC_APP_URL` is https. `issue.ts:530` then returns `link_origin_unavailable`.
- This is the designed refusal for a production server with no origin. My manually started server lacked the setting; the code is not at fault, and with the setting the spec passes.

**Config note (no defect):** the `prod-build` Playwright project only matches `hydration/*` and `help-404`, so `test:e2e:prod` cannot run test 14 or `community-sign-in-invite`. That is why I ran them on a manually started production server.

**Not run:** e2e test 14 against the pre-fix tree. The DB regression test is the red-first evidence.

**Production build (scratch copy outside the platform folder):**
- Run 1 failed with 20 "Module not found: `@vercel/turbopack-next/internal/font/google/font`", all from the Open Sans `next/font/google` CSS. Google Fonts answered 200.
- Run 2 on the same tree, unchanged, was **exit 0**.
- `test:e2e:prod`'s own build and a third build with `NEXT_PUBLIC_APP_URL` set also passed.

I am treating run 1 as a transient font fetch, not a code failure.

**Browser walk, 360×740, light and dark.** I drove it with Playwright on dev 3600 from the HEAD scratch copy and read the screenshots. Page overflow was 0 at every step.

1. **Send.** A UI send from Wren Alder's record worked: the card read "Invitation sent to … It expires 11/9/2026." with "While this invitation is open…".
2. **Archive.**
   - The dialog read: "Archive Wren Alder? Wren Alder will leave the Visitors list and appear under Former. Their record is kept and you can restore it any time. An invitation to Wren Alder is still open. It will stop working, and restoring them will not turn it back on."
   - The dialog sat at x 16, width 328, with buttons Archive and Keep. Read in both schemes.
   - After the archive, the row was `revoked_at` set, `revoked_by` the sender, `blocked_at` null.
   - The archived record no longer contains "While this invitation is open" (`false`).
3. **The person.**
   - Signed in, Wren lands on `/no-organization` with **0** "Accept the invitation" buttons.
   - For the link I used Briar Penhallow, with a seeded token: a UI-sent body never carries the raw token. After a UI archive, `/invite?token=…` is "This link isn't active / This link is no longer active. If you already accepted it, you can sign in. Otherwise ask whoever invited you to send a new one." in both schemes.
   - The page is the same signed in and signed out. It names no congregation and gives no reason.
4. **Restore.**
   - The dialog read "Restore Wren Alder? Wren Alder will return to the Visitors list." with "Keep archived" and "Restore".
   - The record card then read "Invite Wren Alder to sign in. We'll email …" with **Send invitation**. It did not contain "couldn't be completed" or "has ended".
5. **Send again.**
   - A new UI send succeeded and the card read "Invitation sent to …".
   - The Visitors row reads "Invitation sent 11/2/2026".
   - The DB holds two rows: the old one revoked and one open.

**(b) backstop on a pre-existing blocked row.**
- Setup: Corin Halloway had a seeded invitation. Owner SQL on the pipeline branch ended the membership with `community_archived`, the pre-fix archive, which revoked nothing.
- Corin signed in and pressed **Accept**. The page said "This invitation can't be completed. Contact E2E Invitation Church's office." and the row became `blocked` / `membership_ended`.
- While still archived, the card correctly stays "This invitation couldn't be completed because Corin Halloway's connection to E2E Invitation Church has ended."
- After a UI Restore, the card reads "Invite Corin Halloway to sign in…" with Send invitation, and the list row has no "couldn't be completed" marker.
- A send succeeded. The old blocked row is untouched and a new open row exists.

## Regression Tests Added

- `D1: archive, the person presses Accept, restore, the card offers the invitation again — regression for F417 …` (`src/lib/community-engagement.db.test.ts:760`). It guards against archive leaving the link open and acceptance then blocking it for good, which left the card on "has ended" with no button after Restore. **I watched it fail on `d530c41f` (8 soft failures) and pass at HEAD.** It asserts the property, not the mechanism: after Restore the card offers an invitation, there is no blocked marker, a send succeeds and exactly one open row exists.
- The reader backstop (b) block (`src/lib/community-engagement.db.test.ts:947`, 4 tests). It covers the whole class "a stored `membership_ended` block over a live membership": the archive marker, a still-ended membership staying blocked, a participant-style reopen, and `person_merged` not being reinterpreted. `readStates` keys on `memberships.ended_on is null`, not on the path that reopened it, so a different reopening path is covered. I confirmed that on the real void path below.
- e2e test 14 (`e2e/community-engagement.spec.ts:741`, desktop and 360px). It covers the C1 dialog text, the revoked-not-blocked row, both audit rows, no Accept button for the archived person, the dead-link page, and Restore landing on "Send invitation". Green in the dev lane and on the production build. **Not watched red.**

## Coverage on Critical Modules

Not measured this run: `permissions.ts`, `two-factor.ts` and `flags.ts` are not in the diff. The changed modules (`community-engagement.ts`, `onboarding/org-invite.ts`) have unit, DB and e2e coverage of every new branch:
- revoke `ok`, `not_open`, unknown outcome, no row, 42501, audit throw;
- the reader rewrite: on, off, no extra query;
- the archive ordering and rollback.

## Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `archivePersonAction` (`src/app/(org)/o/[slug]/admin/community/actions.ts:172`) | yes. `gate()` calls `auth()` (`:72`) and `resolveOrgContext` from the slug. Organization, acting person and actor come from the session, never from input. | n/a: tenant axis | n/a. The tenant permission is `people.manage`. |

How each part of the gate holds, read from the code:
- **Tenant permission.** `people.manage` is checked through `presby_has_permission` **inside the archive transaction** (`src/lib/community-engagement.ts:368`), before any read or write. It is unchanged by this diff.
- **The revoke runs in the same transaction.**
  - `sideEffects.revokeOpenSignInInvitation(tx, …)` (`:427`) is called with the archive's `tx` after the membership `update` and before the `tenant.person.archived` insert (`:430`).
  - `revokeOpenSignInInvitationInTx` (`src/lib/onboarding/org-invite.ts:572`) runs the definer, `cancelQueuedEmail` and the audit insert all on that `tx`.
  - The definer re-checks `people.manage` for the acting user (`drizzle/0065_presby_sign_in_and_connect.sql:1308`).
  - The action builds the side effect from `g.organizationId`, `g.viewerPersonId` and `g.actor` (`actions.ts:187-200`); nothing comes from input.
- **A throw rolls back the archive.** I ran two DB tests:
  - a forced throw from the archive's own audit row *after* the revoke wrote its row left the invitation open, the membership live, no `invitation.revoked` row, and the link still previewing;
  - a throw from the revoke left the membership unended with no archived audit row.

  Both passed. The action maps a throw to `ARCHIVE_COPY.db_error`.
- **Community flag (pre-existing observation, not this diff).** The action body does not check `org_portal.members_create`. The flag is checked on the Community pages (`page.tsx:122`, `new/page.tsx:75`). The same holds for every 3a action on `origin/main`, and this diff does not touch the gate. The design's line that the action is "behind the Community flag" is true of the page, not the action. A flag never grants access and the permission check is in place, so this is not a FAIL. It is worth a line if the operator wants flag-off to mean refusal at the action as well.
- **Nothing new.** No route, action, `getPlatformDb()`, permission key, flag or audit key was added. The 2b B2 boundary holds: `community-engagement.ts` does not import `org-invite.ts`, and `boundaries.test.ts` is green.

**Audit rows** (from the 360px walk, read on the owner connection):
- `invitation.revoked`: actor = the archiving sender, `resource_type: account_invitation`, metadata `{ via: "archive", origin: "org", purpose: "sign_in", personId, invitationId, organizationId }`.
- `tenant.person.archived`: metadata `{ personId, engagement: "visitor", organizationId, signInConnected: false, invitationRevoked: true }`.

The DB test also pins `invitationRevoked: false` with no `invitation.revoked` row when nothing was open.

## Copy Truthfulness

- [x] **Every added or changed string is in the design's Copy table.** The added strings are C1 (`engagement-copy.ts:299`), H1 and H2 (`adding-people.md:59,63`) and H3 (`sign-in-invitations.md:24`). The other `+` lines are the four test pins of C1. Nothing outside the table.
- [x] **The query behind each claim was opened, and what it does not read was named.**
  - C1, "It will stop working": the revoke runs in the archive's transaction. The person sees no Accept button and the dead-link page.
  - C1, "restoring them will not turn it back on": `restorePerson` touches no invitation and the revoked row is terminal. After Restore the old row is still revoked.
  - C1 is shown only when `invitationOpen`, the card's `pending` state. What it does not read: an open row whose expiry has passed is also revoked silently. The dialog claims nothing about that row, and that is accepted in the design.
  - H2, "Open their record and choose 'Send invitation'": that is the card's own button after Restore, seen at 360px.
- [x] **Each instruction is doable by the role that sees it.**
  - C1, H1, H2 and H3 are read by `people.manage` holders: the Archive and Restore render gates, and the `administrator` audience of both help pages.
  - Restore and Send invitation are both `people.manage` acts. I did them as the fixture sender, who holds `people.manage` and no wildcard.
- [x] **Older strings were grepped, and none is made false.**
  - "Their record is kept and you can restore it any time" (`:303`) is still true.
  - `SIGN_IN_DIALOG_COPY.cancel.body` (`sign-in-copy.ts:220`) is unchanged.
  - `sign-in-invitations.md:28`, the send-time refusal "connection … has ended", still holds: a send to an archived person is refused with it.
  - `:32`, the marker "Invitation couldn't be completed", still exists for merged, deceased and support cases, and for a still-ended `membership_ended` row. Corin's archived card showed that line.
  - **Observation, pre-existing and not made false by this diff (design Out of Scope 3, Phase 4 departure 6):** an archived person's Sign in card offers "Send invitation" and the line "When Wren Alder signs in with …, PresbyPortal connects them to this record if it can." The connection has ended, so that line overstates what will happen. I saw it in the browser on Wren's archived record. It is already proposed as a TODO line for Phase 6 to judge.
- [x] **Help diff covered.** At 360px on HEAD:
  - `/help/adding-people` and `/help/sign-in-invitations` both return 200 and render "Archiving cancels that invitation.", "Restoring does not bring back an invitation that was open when they were archived. Open their record and choose "Send invitation" to send a new one." and "Archiving a person cancels an open invitation too, and restoring them does not turn it back on." Page overflow was 0 in both schemes.
  - Every claim was walked against the screens above (dialog, archived record, restored record, the second send).
  - Quoted labels seen on screen: "Archive", "Restore", "Keep archived", "Send invitation", "Former".
  - No `labels` entry changed, no image under `src/content/help/images/` is in the diff, and `verifiedIn` did not move.
  - `check:help` passes.

**copy truthfulness: PASS**

## Implementer's unverified items

| Item | Status |
|---|---|
| **Participant-removal void path** | **Now verified through the real void.** At 360px, Dace Rowntree was an approved participant with a seeded invitation. In the UI: "Remove as participant" ended the membership with `other_participant_removed`. Dace pressed Accept and was refused ("This invitation can't be completed"); the row became `blocked` / `membership_ended` and the card read "…connection … has ended." Then "Undo last entry" with a reason recorded a `void` roll action, the real `presby_void_roll_action` path (`roll_actions`: enrolled, removed, void, all approved). The membership reopened (`ended_on` null) and the card read "Invite Dace Rowntree to sign in…" with Send invitation. This needed the global flag `org_portal.members_roll_action_edit`; I set it for the run and restored it to baseline. |
| **Race test** | **Ran and passed**, both orders: acceptance first ends `accepted` with `invitationRevoked: false`; archive first ends revoked with acceptance `dead`, never `blocked`. Nothing else was active on the branch during the DB run. As Phase 4 says, the test pins the observable result of the organization-lock order by queueing the two calls behind a held lock. It does not pin a free-running interleaving. |
| **42501 mid-request end to end** | **Stays unverified end to end.** It is covered by unit tests and by the DB test where the definer refuses an actor without `people.manage`. The action checks `people.manage` in the same transaction first, so the window is narrow. |
| **Long-surname clipping** | **Confirmed pre-existing on `origin/main`.** With "Cordelia Wolfeschlegelsteinhausenbergerdorff-Featherstonehaugh" at 360px, the dialog box is x 16, width 328, right edge 344. On both HEAD and a `d530c41f` dev server, the title, the body line, the invitation line and both buttons extend to x 379 (scrollWidth 338). Page overflow is 0. The geometry is identical, so C1 neither causes nor worsens it. Suggest the TODO line Phase 4 proposed. |

## Verdict

**PASS**

- The regression test was watched failing on the pre-fix tree and passing at HEAD.
- Typecheck, lint, all ten tripwires and the unit suite are green.
- The touched and neighbouring DB suites are green (76 + 269).
- The production build passes on retry; the first failure was the transient Open Sans fetch.
- e2e is green in the dev lane (56), in the prod lane (6), and on the production build for test 14 and `community-sign-in-invite`. The 10 failures in the first production-server run came from my server's missing https origin, and the run is green with it set.
- The feature-gate, audit and copy-truthfulness checks hold.
- The D1 sequence and the (b) backstop on a pre-existing blocked row both clear at 360px in light and dark.

This diff does not touch auth, so the MFA-login gate does not apply.

---

**Per-Phase Status row**

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Done: regression red on `d530c41f` (8 soft failures), green at HEAD. Typecheck, lint, `check` (10/10), unit 13247 passed. DB 76 touched + 269 neighbours. Prod build green (first attempt failed on a transient font fetch). e2e dev 56/56, prod lane 6/6, test 14 and sign-in-invite green on a production build. 360px walk of D1, (b) and the real participant void, light and dark. Flags reset to the CI baseline first. Long-name clipping pre-existing on main. 42501 stays unit-pinned. | PASS | 2026-11-02 |

**Handoff: analyst (Phase 6).** Re-walk D1 on the record and the list, then the four help pages the 3a addendum left open. Two observations need a ruling:
1. The archived record's Sign in card still offers "Send invitation" with a "connects them … if it can" line (Out of Scope 3, pre-existing).
2. `archivePersonAction` does not check the Community flag itself; only the page does (pre-existing across 3a).

For the orchestrator, proposed TODO lines:
- long unbroken names clip in the Archive and Restore dialogs (pre-existing, confirmed on `origin/main`);
- optionally, the `prod-build` Playwright project cannot run invitation-send specs, and a local production server needs an https `NEXT_PUBLIC_APP_URL` for sends to work.

Evidence is all under `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/410a32fe-fd9e-4967-be0f-2033724f8e16/scratchpad/qa-f417/`:
- logs: `red.log`, `db1.log`, `db2.log`, `unit.log`, `build.log` and `build2.log`, `e2e-dev.log`, `e2e-prod.log`, `e2e-prodserver.log`, `e2e-prodserver2.log`;
- the walk: `walk.log`, `walk-p.log`, `walk-h.log`, `walk-main.log`;
- screenshots: `shots/`.

---

## Phase 6: Shipped vs Intent (analyst), F417, archive revokes an open sign-in invitation

**Date:** 2026-11-02. Bug-fix variant. HEAD `da39cda0`, branch `pipeline/archive-revokes-invite`, Neon `pipeline-archive-revokes-invite`.

**How I walked it**
- A dev server from a scratch copy outside `~/git/presby-platform/`, on port 3610, with `NEXT_PUBLIC_APP_URL=http://localhost:3610` and a private `PLAYWRIGHT_BROWSERS_PATH`. The first compile hit the transient Open Sans fetch error QA reported, and a clean restart fixed it.
- Chromium at 360px, light and dark. Page overflow was 0 on every page.
- I made a fresh organization, "Larkspur Fells Presbyterian Church", through the app. The platform admin created it. The founding administrator was created by accepting an invitation, then enrolled two-factor and landed on `/o/walk-f417`. This is the person the path creates, not a seeded fixture.
- I turned Community on from the Features switch.
- SQL supplied only what the app cannot:
  - flags;
  - bcrypt accounts for the invitees;
  - one known-token invitation;
  - an events role set up the way the PresbyPortal team would set it up.
- I reset the 13 flags I changed to `false`, so only the baseline flags are on. I stopped the server by PID and port 3610 is free. The repo is untouched.
- Fixtures stay on the throwaway branch.

---

## VERDICT

**SHIP WITH NOTES**

F417 is fixed and I found no regression. The notes are follow-ups, not blockers. One of them is a release-note requirement: the fix deliberately changes a behaviour.

## ONE-LINE TAKE

> Archive now cancels the person's open invitation, the person gets the dead-link page, and Restore leaves the record offering "Send invitation". I re-invited an archived-then-restored visitor through the UI, and he accepted and landed in the congregation.

## What's Working

**D1, exact sequence, on the record, light.** Marguerite Thistlewood was a visitor with a verified account on her address.
1. The UI send left the card reading "Invitation sent to … It expires 11/9/2026" with "While this invitation is open…".
2. Archive, from the record. The dialog read: "An invitation to Marguerite Thistlewood is still open. It will stop working, and restoring them will not turn it back on." Its box was x 16, width 328, with the Archive and Keep buttons inside. The row went `revoked`, revoked by the sender.
3. The archived record no longer says "While this invitation is open" (checked: false).
4. She signed in and landed on `/no-organization`. It has 0 "Accept the invitation" buttons and says "…or to invite you".
5. Restore. The dialog said "Return to the Visitors list" with "Keep archived" and "Restore". The record then read "Invite Marguerite Thistlewood to sign in…" with Send invitation. It does not contain "couldn't be completed" or "has ended".
6. A second send worked, and the DB holds one revoked row and one open row.

**D1 on the list, dark.** Barnaby Quillfeather had a seeded invitation with a known token.
- As a control before the archive, the signed-in link offered "Accept invitation".
- The Archive dialog from the list row carried the same line and fit at 360px, with overflow 0.
- The Former row read "Archived visitor, 11/2/2026".
- The signed-in link now shows "This link isn't active … ask whoever invited you to send a new one", with no Accept button.
- The signed-out link shows the same page. It names no congregation and gives no reason.
- After a Restore from the Former row, the Visitors row has no marker and the record card offers Send invitation.
- The old link stays dead after Restore.
- A new UI send worked.

**The end-to-end outcome D1 broke.** Barnaby signed in and `/no-organization` offered "You're invited to Larkspur Fells Presbyterian Church" with "Accept the invitation". He accepted and landed on `/o/walk-f417` with the "Coming up" card and the tiles. The DB shows `people.user_id` set. A person who was archived and restored can now be invited and connected from the product.

**Pages the person lands on.**
- Marguerite after the archive: `/no-organization`, "You're not connected to a congregation yet", with "Check again". She has no Accept button.
- Barnaby after the accept: `/o/walk-f417`, with `/calendar` opening and listing events.

**Audit, from QA's walk and consistent with mine.**
- `invitation.revoked` carries `via: "archive"`, the sender as actor and `purpose: "sign_in"`.
- `tenant.person.archived` carries `invitationRevoked: true`.

## Intent-vs-Shipped Diff

- **D1:** Phase 1 said Restore must never leave a terminal "connection has ended" card or marker. Shipped: archive revokes the open invitation, and the reader treats a stored `membership_ended` block as stale over a live membership. QA's walk of a pre-existing blocked row and of the real participant void confirms the reader half. Matches.
- **D1 second symptom, "Accept the invitation" offered while archived:** shipped as 0 buttons, plus the dead-link page. Matches.
- **D1 second symptom, "While this invitation is open…" on the archived record:** gone. Matches.
- **"Contrast: never opened the link, archive then restore leaves it working":** now the link stops at archive and Restore leaves it stopped, as the dialog says. This is a deliberate behaviour change, not a regression, and the design's Carry-forward already records it. **It must appear in the release note.** Acceptable drift.
- **Dead-link wording:** "ask whoever invited you" reaches an archived person whose inviter cannot send until Restore. This is the design's accepted `paper` residual (DECISION-147). Acceptable.

## Rulings on QA's two observations

1. **The archived record's Sign in card still offers "Send invitation", with "PresbyPortal connects them to this record if it can." — follow-up TODO, not NEEDS REWORK.**
   - I saw it on both archived records. The send is refused with the truthful "connection to … has ended, so they can't be invited".
   - It is pre-existing. It happens today for an archived person who was never invited.
   - It is no longer a dead end. F417 closes that path, and Restore clears the state.
   - It is wording and affordance, not a defect in the fix. The proper fix is a state on the card for an ended connection: say "Restore them first" and drop the button. That is a card change with its own copy and tests, so it should not ride this bug fix.
2. **`archivePersonAction` does not check the Community flag — follow-up TODO, not NEEDS REWORK.**
   - The same holds for every 3a Community action; the flag is checked at the page.
   - `people.manage` is checked inside the archive transaction, and the revoke definer re-checks it.
   - A flag never grants access, so the exposure is a `people.manage` holder posting directly while Community is off.
   - Decide as one change across all the 3a Community actions whether flag-off should refuse at the action.

## Edge Cases

- Empty state: pass. An empty calendar says "hasn't added any events yet" with "Add an event". Community empty says "No one is listed yet".
- Failure microcopy: pass. The archived-record send refusal is human. The dead-link page is neutral.
- Permission gate: pass (read from QA's audit; I added no probe). `people.manage` is checked in the transaction, and the action takes the actor from the session.
- Audit event: pass, as above.
- Mobile (360px): pass in light and dark. Overflow was 0 on every page. The Archive and Restore dialogs fit at 328px wide.
- Help pages read as their reader (the two named by the Phase 3 Help impact line, `adding-people` and `sign-in-invitations`): pass for H1, H2 and H3, with the other wording items below. Each H1, H2 and H3 claim was true on screen, as follows:
  - Archiving cancels the invitation: seen, in the audit and on the screens.
  - Restoring does not bring it back, and "Send invitation" on the record sends a new one: seen.
  - The "Cancel invitation" dialog is "Cancel this invitation?" with "Keep it": seen.
  - No `limitationUntil` sentence is affected.

## The four open help pages (the 3a walk)

**1. `roles-who-can-do-what`: may move to `verifiedIn: "0.54.1"`. Nothing blocks.** (The text is identical on 0.54.0, so either label is true.)

Read at 360px, light and dark, as the founding administrator, with `org_portal.branding` on:
- **First-day Branding refusal.** The tile appears on the hub, and the page says "You don't have permission to manage branding at Larkspur Fells Presbyterian Church. If you think this is a mistake, ask your stated clerk or another administrator there." This matches the help's quoted prefix.
- **"Manage events" and "Event types" refusals.** The same shape, with the same quoted prefixes.
- **The six-role table.** Founding Administrator and Stated Clerk are held by the person (Ottoline), and four are held by groups. In the catalog, those two show "Edit" and four are "Constitutional".
- **"Role granted."** I granted a role through the form and the message matched.
- **"Website domain".** It is absent from the Features page, as the help says. "Job openings" is present.
- **Disclosure.** I did not re-walk the Revoke, Create role, template adoption and Deactivate sections this time. The 3a diff did not touch them. The sections 3a did change (the group rows, the "All Current Records … visitors" sentence, the first-day lists) all matched. The move is on that scope.

**2. `events-and-the-calendar`: NOT yet.** Two blockers, both from your N-notes, and both reproduced on this build.
- **N2.** At 360px "Month" and "List" are hidden (`isVisible` false). The calendar shows "Today", "Copy month", "Show filters" and the arrows. "On a phone it shows a list of days. The links 'Month' and 'List' switch the view" is false on a phone. An empty calendar shows no controls at all.
- **N1.**
  - Barnaby is a connected visitor. He saw "Session retreat (members only)" in "Coming up" and on `/calendar`. The event page is tagged "Members only".
  - The help says an unticked event "shows only on the member calendar, for members who have calendar access". A reader takes that to exclude visitors.
  - Both the help and the label "Open to everyone, not only members" are literally contradicted for visitors.
  - This needs an operator ruling: filter, or reword.
- **Everything else was walked and matches.**
  - "Add an event", "Manage events" and "New event".
  - "Event created." and "Enter a number of occurrences from 1 to 52."
  - "Part of a series", "Extend this series", the "Cancel event" dialog and "Cancelled" in the list.
  - The Event types page: the "Retired" and "Offered" labels and "The default type can't be retired."
  - The members-only event's website tick is disabled.
  - "Put this and later events on the website", with its dialog and toast ("4 events marked for the website.").
  - "It appears on your public website once your congregation's public events calendar is turned on and your website has a calendar page."
- **Unwalked:** the "Public events calendar" end to end on a real website.
- **Unlocks when:** N2 is reworded (a text edit), N1 is decided and applied, then a re-walk.

**3. `adding-people`: NOT yet.** One blocker plus unwalked sections.
- **N3.** The engagement dialog's buttons are "Keep as it is" and "Mark as regular attender". The help puts 'Choose "Save engagement"' after the dialog sentence. "Save engagement" is the card button that opens the dialog. This is still unfixed in HEAD (line 55).
- **Walked and matching:**
  - "Step 1 of 6" and the three connection labels.
  - The Community views.
  - "Visitor added." The member proposal: "Person added. They'll appear as a member once the Session approves."
  - "Pending approvals", the "1 waiting" count, "You proposed this", "Withdraw", and "Your Session roster is empty".
  - H1 and H2, archive and restore.
  - QA's participant remove and "Undo last entry" via the real void.
- **Not walked:** Session approve, deny and "Select all on this page", "Self-approved", and the three other banners ("No one can approve yet" with its variants and the per-member rows).
- **Unlocks when:** N3 is reordered and the approval and banner sections are walked.

**4. `sign-in-invitations`: NOT yet.** Two text blockers.
- **TODO line 487.** `:17` and `:49` still say a person "isn't listed in the member directory" is not connected. A staff record is not listed but connects. The line is still open.
- **One new wording mismatch.**
  - A role-holder who has not set up two-factor sees "One more step: set up two-factor sign-in to finish connecting. Then come back here and select Check again." with the button "Set up two-factor sign-in".
  - The help quotes "…confirm two-factor sign-in…" for that state, and then says the button is "Continue to verification, or 'Set up two-factor sign-in' if they have not set it up".
  - It presents one sentence for two states. I saw only the unenrolled sentence.
- **Walked and matching:**
  - The send dialog.
  - The do-not-contact acknowledgement. The first press of Send brings up "…asked not to be contacted at this address. This is a one-time account email, not marketing. Send it anyway?" with the checkbox "I understand, send it anyway".
  - "Invitation sent … It expires …", "Sent", "Send again", the Cancel dialog, and H3.
  - The existing-account acceptance page ("You're invited to …" with "Accept the invitation").
  - The list marker "Invitation sent" and a date.
- **Not walked:** the enrolled-person variant of the two-factor step ("Continue to verification").
- **Unlocks when:** `:17`/`:49` and the two-factor sentence are corrected, and the enrolled variant is walked.

## `verifiedIn`

| Page | May move now? | To |
|---|---|---|
| `roles-who-can-do-what` | **Yes** | `"0.54.1"` |
| `events-and-the-calendar` | No | blocked by N1, N2 |
| `adding-people` | No | blocked by N3, plus the unwalked approval sections |
| `sign-in-invitations` | No | blocked by TODO 487 and the two-factor sentence |

From the 3a addendum, `using-the-directory` and `what-presby-portal-does` already clear to "0.54.0" (the addendum calls the second `what-presbyportal-does`). The orchestrator moves them with `roles-who-can-do-what`. After the text edits above, the other three can be re-walked in one short pass and move to "0.54.1".

## Follow-Ups (TODO lines)

1. `- [ ] **Archived record's Sign in card still offers "Send invitation" and "connects them … if it can" (F417 observation, pre-existing).** Show an ended-connection state on an archived person's card ("Restore them first"), with no send button, so the offer matches the refusal. Not a dead end since F417. — 2026-11-02-archive-revokes-invite`
2. `- [ ] **Community actions do not check the Community flag (pre-existing across 3a).** The page checks \`org_portal.members_create\`; \`archivePersonAction\` and its siblings check only \`people.manage\`. Decide once whether flag-off should refuse at the action, then apply it to all of them. — 2026-11-02-archive-revokes-invite`
3. `- [ ] **Long unbroken names clip in the Archive and Restore dialogs at 360px (pre-existing, confirmed on origin/main).** Title, body lines and buttons run past the dialog's right edge; the page itself does not overflow. — 2026-11-02-archive-revokes-invite`
4. `- [ ] **Release note for F417 must state the behaviour change.** An open invitation now stops working at Archive and Restore does not turn it back on; before, an unopened link survived archive then restore. The administrator sends a new one. — 2026-11-02-archive-revokes-invite`
5. **Add to the existing TODO line 487 (`sign-in-invitations` wording):** the two-factor sentence. The unenrolled role-holder sees "set up two-factor sign-in to finish connecting", and the help quotes "confirm" for the page generally. Say which sentence goes with which state, then walk the enrolled variant ("Continue to verification").
6. **Existing lines stay open:** N1 (members-only events versus visitors, operator decision), N2 and N3 help edits, and the re-walk and `verifiedIn` bump for `events-and-the-calendar`, `adding-people` and `sign-in-invitations`. Edit the existing 3a lines; do not add duplicates.
7. `- [ ] **Walk the unwalked adding-people approval sections** (approve, deny, select all, "Self-approved", and the three other banners) with a connected Session member, then move its \`verifiedIn\`.`
8. QA's proposed lines: the `prod-build` Playwright project cannot run invitation-send specs, and a local production server needs an https `NEXT_PUBLIC_APP_URL` for sends to work. Optional, at the orchestrator's discretion.

**Housekeeping at ship.**
- **Rule 12:** no feedback row. The source is my own live walk.
- **Rule 13:** no what's-new. It is a bug fix, and the operator holds what's-new for now.
- **Rule 14:** no functionality-map change. It is a correction of an existing line.
- **Rule 15:** `docs/architecture.md` unchanged.
- **DECISION-315:** the orchestrator adds the drafted DECISION-315 to `docs/decisions.md` at integration.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 6 — Shipped vs intent (F417) | analyst | Done: D1 walked in the exact sequence at 360px in light and dark, on the record and on the list, as a founding administrator created by the real invitation path. Archive revokes, the person gets the dead-link page with no Accept button, Restore offers Send invitation, and a re-sent invitation was accepted end to end. Both QA observations ruled follow-ups. Four help pages read against the live screens: `roles-who-can-do-what` may move to 0.54.1; the other three stay blocked on N1, N2, N3, TODO 487 and a new two-factor wording mismatch. Flags reset, server stopped by PID. | SHIP WITH NOTES | 2026-11-02 |

**Handoff:** the orchestrator records this section in `docs/work-log/2026-11-02-archive-revokes-invite.md`, files the TODO lines in `docs/TODO.md`, moves `roles-who-can-do-what` (and the two 3a pages the addendum cleared) to the `verifiedIn` values above, and adds DECISION-315 and the release note. The next agent for the three blocked pages is the tech-lead for the help text edits, then the analyst for one short re-walk. N1 goes to the operator first.

Absolute paths:
- Work-log: `/Users/cshenso/git/presby-platform/presby-archive-invite/docs/work-log/2026-11-02-archive-revokes-invite.md`
- Walk scripts and screenshots (scratch, not in the repo): `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/410a32fe-fd9e-4967-be0f-2033724f8e16/scratchpad/f417-walk/` and `.../f417-walk/shots/`
