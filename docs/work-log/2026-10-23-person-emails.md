# Multiple email addresses per person — Work Log

> **Slug:** `2026-10-23-person-emails`
> **Surface:** (org) — the person record (Community add and edit), and every place the app reads a person's email
> **Permission(s):** existing (`people.manage`); Phase 1 confirms
> **Flag(s):** not needed (operator: no new platform flags before go-live)
> **Estimated complexity:** medium
> **Pipeline mode:** Full
> **Source:** operator, 2026-10-23: "we need to support multiple emails per person. staff members will have personal emails and work emails. we'll need to take into account which emails to use when sending emails throughout the app. record the fact that thought needs to go into that. go ahead and add support for multiple emails."
> **What exists:** `contact_methods` already allows several rows per person, with `kind` (email | phone), `subtype` (mobile | home | work), `is_primary` and `do_not_contact`. The person form and most readers handle one email only (`edit-person-form.tsx` maps a single `person.email`).
> **Pre-assigned numbers (Rule 16):** DECISION-215–219 · F210–F219 · migration **0064** (re-reserved at Phase 2, ER2: Community Increment 2 keeps 0062/0063 and 2b moves to 0065; merge order Increment 2, then emails, then 2b) · worktree `presby-emails` · Neon branch `pipeline-person-emails` (`br-proud-lake-axcms7o7`, 1–4 CU). Community Increment 3 keeps DECISION-209–214 and F200–F209.
> **Interaction:** Community Increment 2b (sign-in invitations) reads "the primary email on file" and refuses `several_emails_none_primary` and `address_shared`. This pipeline settles the rules 2b relies on, so it should implement before 2b's Phase 4.

> **Recorded concern (operator, 2026-10-23): which address the app sends to.** Once a person can have a personal and a work address, every place the app sends email has to choose one. Examples: invitations, giving receipts and statements, event notices, support-ticket replies, and future newsletters. A staff member's role mail may belong at the work address, and their personal mail at the personal one. Phase 1 inventories every send path and proposes a rule for each. Anything not settled in this pipeline is recorded as a tracked follow-up, not dropped.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-23 |
| 2 — Architectural review | architect | Complete. ER1–ER24; migration 0064 (2b moves to 0065); new module `src/lib/contact-methods/`; DECISION-215–218; F210–F214 | Approved with suggestions | 2026-10-23 |
| 3 — Technical design | tech-lead | In progress | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator from the analyst's returned text.*

Pipeline `2026-10-23-person-emails`. I read the work-log, the code paths named in the brief, and Increment 2b's Phase 1 and 2 text. I ran read-only aggregate queries on the pipeline branch (`ep-winter-leaf-axct4hlj`, which is not the development endpoint `ep-lingering-meadow-axnarpsq`). I did not touch production or development.

## VERDICT

**READY WITH NOTES.** The feature shape is clear and nothing blocks design. Four notes go to the architect and tech-lead as Phase 2 and 3 inputs:
- the migration-order conflict with 2b;
- the soft-removal shape;
- the shipped 0059 readers;
- the global-table visibility residual.

## ONE-LINE TAKE

> Adding more addresses is easy. The real work is that nothing today needs to choose one, because nearly every send goes to an account email. So this pipeline should settle the data rules (exactly one main address, soft removal, one deterministic reader) and record the per-purpose routing table as tracked follow-ups, with "the main address decides" as the interim rule.

---

## What the code actually does today

- **`contact_methods` is a GLOBAL table.** It has `person_id` and no organization column, and its row-level-security policy is "visible via a membership in the current org". It has no CHECK on `kind`, `subtype` or `value`. It has no uniqueness of any kind: not one primary per person, not one row per address.
- **The edit form and `updatePerson()` assume one primary row per kind.** `upsertPrimaryContactMethod` updates that row in place, and a blank value deletes it. That hard delete is F176. It breaks the operator rule that all deletes are soft, and it also hard-deletes phones.
- **`createPerson` writes one primary email and one primary phone.** No importer exists in the codebase, only `createPerson`, the wizard and seeds.
- **Readers pick the "first" email with `order by is_primary desc, id limit 1`.** This applies to `directory.ts`, `community.ts` and the card. If a person has several addresses and none is primary, the one shown is arbitrary, because it is ordered by a random UUID.
- **The member directory** shows one email per person, nulled by `person_privacy.hide_email`. It renders as a `mailto:` link.
- **The public staff directory** never selects `contact_methods`. Its function comment says widening that "requires its own pass through the pipeline".
- **`findDirectoryPersonIds` (find-a-person) matches ANY contact row.** That includes the address of someone with `hide_email` set, and addresses the card never displays.
- **`person_identifiers` is read but never written by app code.**
  - Writers are seeds only. The matcher `presby_match_person()` (a SECURITY DEFINER function that can see across orgs) and the giving donor-link proposals read it.
  - It carries `is_verified` and `is_shared`. Only a verified, non-shared identifier is treated as decisive.
- **`people.user_id` and `users.email` are unrelated to contact emails.**
  - Only the 2b/0059 accept step connects them: it sets `verified_at` on the matching contact row.
  - On the branch, only 3 of 20 linked accounts have an account email that appears among their contact emails.
  - Contact emails authenticate nothing, and that is correct.

## Pass 1 — User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Admin with `people.manage` (Community edit and the add wizard) | Add an address to a person | on demand |
| Same | Choose a label: Personal, Work, Other | on demand |
| Same | Mark one address as the main address | on demand |
| Same | Fix a typo in an address | on demand |
| Same | Remove an address | on demand |
| Same | Mark an address "don't send mail here" (the existing `do_not_contact` column) | on demand, rare |
| Same | See all of a person's addresses on the Community card | per visit |
| Authenticated member with `directory.view` | Read one email per person, the main address, in the directory (unless the person hides it) | per session |
| Member | Find a person by typing an address | per session |
| Anonymous visitor | No verb. The public site shows no addresses. | — |
| Signed-in person editing their own addresses | **Not in scope**, see Q-default 5 below | — |

No verb belongs to the "newly-authenticated, no roles" surface or to a platform admin. The request says "staff members will have personal and work emails" but names no one who types them. I take it to be the congregation's `people.manage` holder, since no self-service surface for contact data exists.

## Pass 2 — Flow Audit

**Flow 1 — Add an address to an existing person.**
- Entry: `/o/<slug>/admin/community/<id>/edit`. The single "Email (optional)" field becomes an "Email addresses" list: rows of address, label and a "Main address" radio, plus "Add another address".
- A person's first address is the main address automatically.
- Save goes through one server action inside one transaction.
- Success: back to the card, which shows every address with its label and a "Main" badge.
- Failure outcomes:
  - Bad syntax: an inline field error, with the same check server-side.
  - A duplicate within the person: "That address is already on {Name}'s record."
  - Primary rule violated: see Flow 3.
  - Database error: "We couldn't save. Nothing was changed. Try again." and the form keeps the values.
  - The person is not visible in this org: `not_found`, byte-identical to "no such person".

**Flow 2 — Change the label or fix a typo.**
- Label change: update in place.
- Fixing a typo or changing an address: **end the old row and insert a new one** (see Gap 2). This keeps `verified_at` honest and gives a history.
- Failure: as in Flow 1.

**Flow 3 — Remove an address.**
- Removing a non-main address: the row gets `ended_at` set and disappears from the form and from every reader.
- Removing the main address while others remain: the form requires choosing a new main in the same save. The server refuses with `primary_required` otherwise, and does not auto-promote silently (see Gap 1).
- Removing the only address: allowed. The person then has "no email on file", which 2b already maps to `no_email_on_file`.
- Empty state: a person with no address shows "No email address. Add one." Today a blank field simply deletes.

**Flow 4 — Add person wizard.**
- The same list editor, with the first row required to be the main.
- The wizard's duplicate-match step already passes the typed email to `presby_match_person()`. Any additional addresses should be passed as well, so a work address can also flag a duplicate. That is cheap: the function already takes an array of identifiers.
- Failure outcomes as in Flow 1.

**Flow 5 — Directory and find-person reads.**
- The directory shows exactly one address: the person's active main address, unless `hide_email` is set.
- Find-person searches only what the card would show (see Gap 8).

**Flow 6 — A send.**
- Today almost none read `contact_methods`. See the send-path inventory in Pass 3.

## Pass 3 — Permissions and Flags

- **Permission:** the existing `people.manage` reused for every write. The reads keep their current gates (`directory.view`, `people.manage` for the admin surface). No new `FEATURES` key.
- **Flag:** not needed (operator: no new platform flags pre-live). Rollback plan: the migration is additive (a column and indexes). The old reader code ignores them, so a code revert is safe. Existing rows with exactly one primary satisfy every new constraint.
- **Audit:** security-sensitive, because an address decides where credential links go. Writing `tenant.person.updated` with an `emailChanged` boolean is too coarse. Add `tenant.person_email.added`, `.ended` and `.primary_changed`. The metadata carries the contact row id and the label, **not the address value**. The ended row keeps the value, so nothing is lost and the audit log stays free of PII.

### The send-path inventory

I grepped every `enqueueEmail` caller and every reader of a person's email. The finding is that **today only the invitation path ever reads `contact_methods`.** Every other sender uses an account email, a donor email, or a typed address.

| # | Send path | Where the address comes from today | Proposed rule | This pipeline |
|---|---|---|---|---|
| 1 | Password reset, email-change verification, email verification | `users.email`, the account email | Unchanged. Contact emails must never be used here, and a source-scan test should say so. | Implement a guard test |
| 2 | Feedback notification, ticket operator and new-ticket notices, domain notices (`notify.ts`) | The account emails of platform admins, ticket operators and `domains.manage` holders (`people.user_id` joined to `users`) | Unchanged. These are platform and account mail, not person mail. | No change |
| 3 | Ticket filed confirmation, ticket operator reply to a member | `session.user.email`, the account email | Unchanged. Reply goes to the account that filed it. | No change |
| 4 | Org designation invitations (founding administrator, treasurer) | A typed address, matched to a person by ANY `contact_methods` row (`resolveTreasurerPerson`, and the 0059 accept and preview functions) | The match considers active addresses only (ended rows excluded). Ambiguity (the same address on two people) stays `ambiguous_person`. | **Implement** (reader filter) |
| 5 | 2b sign-in invitation | R20: the person's one active primary email, read inside the definer | Primary only, regardless of label. Acceptance (R27) passes any active address of the person. Ended addresses must not pass. | **Implement** the invariant 2b depends on |
| 6 | Giving statement notice | `giving_donors.email`, snapshotted into `giving_statements.delivery_email`. It never reads the person's emails. | Follow-up: when a donor is linked to a person, a future "use the member's email" default should be the primary non-work address. A giving receipt must never go to a work address by default. | Track |
| 7 | Statistics submission grant | A typed `issuedToEmail` | Unchanged | No change |
| 8 | Event notices, newsletters, RSVP reminders | Do not exist. What's-new is in-app only. | Define the purpose classes now, wire them when the first sender is built. | Record as a table, don't build |
| 9 | Resend bounce and complaint webhook | Updates `email_queue` only | Follow-up: a hard bounce should mark that address's `do_not_contact` so no future sender uses it. | Track |
| 10 | Directory `mailto:` link | The primary email | The main address only | **Implement** (deterministic read) |

**The proposed routing contract**, which this pipeline records and implements as one pure function plus one SQL reader, without wiring new senders:

| Purpose class | Rule |
|---|---|
| `credential` (sign-in invitation) | The primary, active address. |
| `role` (staff and officer role mail, when it exists) | The active Work address if any, else the primary. |
| `personal` (giving, pastoral care, newsletters, events) | The primary if it is not Work, else the first active Personal or Other address, else no send. |
| Any class | Skip an address with `do_not_contact`. Transactional classes warn instead, as the invitation path already does (G19). |

The operator asked that this be thought about, not silently decided. So the **interim rule is "the main address decides every send"**, which is exactly today's behavior. Purpose routing is a tracked follow-up that lands with the first sender that needs it (see Q-default 2).

## Pass 4 — Gaps the Request Didn't Address

1. **"Exactly one primary" is not enforced anywhere, and 2b relies on it.**
   - Resolution: at most one at the database, with a partial unique index on `(person_id) where kind='email' and is_primary and ended_at is null`.
   - At least one (when any active address exists) is an app rule enforced in the same transaction.
   - The first address becomes primary automatically.
   - Removing or demoting the primary without naming a successor is refused with `primary_required`.
   - **No silent auto-promotion.** Moving mail from a personal address to a work one without the administrator choosing it is the exact failure the operator is worried about.

2. **Removal is a hard delete today, and the operator rule is that all deletes are soft.**
   - Proposed shape: add `ended_at timestamptz` (and optionally `ended_by`) to `contact_methods`, and stop hard-deleting.
   - Apply it to the whole table, phones included. The same function handles both kinds, so the marginal cost is nil, and it closes F176.
   - Once no code path deletes, revoke `delete` on `contact_methods` from `presby_app`. Test fixtures use the owner connection, so they are unaffected.
   - Treat editing an address as end-and-replace, never an in-place value change. Otherwise `verified_at` would claim proof for a different mailbox.
   - Open detail for tech-lead: whether `do_not_contact` carries over to the replacement row on a typo fix.
   - Removing a contact row does count as the kind of event the rule covers: addresses are personal data, but the church record is permanent. The ended row keeps the value, so the audit trail points to the row id.

3. **Every existing reader of `contact_methods` silently ignores `ended_at`, and some of them are shipped security code.**
   - Reader list: `people.ts`, `directory.ts` (the card lateral, the search, `findDirectoryPersonIds`), `community.ts`, `issue.ts` (two queries), and four sites in the **already-shipped 0059** `presby_accept_invitation` and preview functions (the address-match select, the match count, the `limit 1` select, the `verified_at` update).
   - Without a filter, a removed address would still pass the R27 acceptance check. That reopens F192, where a link sent to a corrected-away mailbox could still be accepted.
   - 0059 is live (v0.37.0), so it is fixed forward in a new migration, not edited in place.
   - Add a source-scan test: every file that names `contact_methods` must also name `ended_at`, with an annotated exemption.

4. **Migration numbering conflicts with 2b.**
   - 0062 to 0064 are reserved for Increment 2 and 2b. This pipeline's `ended_at` column is "0065 if needed".
   - But 2b's 0064 definers must filter on `ended_at`, and a column created in 0065 cannot be referenced from 0064.
   - The 2b Phase 4 gate already says to implement this first.
   - **The orchestrator needs to renumber:** this pipeline's DDL gets a number below 2b's definer migration, or 2b's definer migration moves above this one. This is a Phase 2 and 3 input. I am not choosing the numbers.

5. **Labels.**
   - The existing `subtype` vocabulary is mobile, home or work, with no CHECK. On the branch's 24 email rows, 11 are `home` and 13 are null.
   - The operator says "personal and work". Proposed for emails: Personal, Work, Other (null allowed and displayed as plain "Email").
   - Whether to store `personal` and migrate `home` to it, or keep `home` and display "Personal", is a Phase 3 call. Either way, add a CHECK for email subtypes so a typo can't create a fourth.

6. **Value validation.**
   - Normalize on write (trim, lowercase) and add a shape CHECK like the one on `account_invitations.email_normalized`.
   - The branch has 0 bad, 0 untrimmed and 0 mixed-case rows.
   - **Production was not measured.** Use `NOT VALID` first, then validate after the operator or orchestrator runs the pre-flight below against production read-only.
   - Uniqueness within a person: a unique index on `(person_id, lower(btrim(value))) where kind='email' and ended_at is null`. Re-adding an ended address inserts a new row.

7. **The same address on two people.**
   - Household sharing is legitimate. The branch has exactly one such pair.
   - Allow it, with a non-blocking note on save: "Also on file for {Name}". That check must run on the row-level-security connection, so it can only name people at the current org.
   - **It must never be checked across orgs.** A refusal like "belongs to another congregation's person" would be an enumeration oracle (DECISION-040's reasoning). Cross-org sharing is silently allowed.
   - 2b's `address_shared` refusal (R29) stays 2b's, and it only blocks invitations.
   - Sharing a mailbox such as an office address across several staff raises `ambiguous_person` on treasurer invitations. That is the right behavior, but the copy should tell the sender why.

8. **Find-person and directory search are privacy oracles that widen.**
   - `findDirectoryPersonIds` matches any contact row, even for a person who set `hide_email`. A member can confirm that a hidden personal address belongs to a person by typing it. The code's own comment admits this, but with several addresses per person it gets worse.
   - Recommend matching only the address the card would display, respecting `hide_email`. This is a small tightening, to be filed as its own F number.
   - Directory search should use the same single address.

9. **`do_not_contact` has no way to be set.** No form field writes it, and only the invitation path reads it (a warning). Either add a per-address checkbox ("Don't send mail to this address") or drop it from the resolver contract. I recommend the checkbox, because the routing contract and the bounce follow-up both rely on it.

10. **The global-table visibility residual.**
    - `contact_methods` has no organization column, so a work address typed by congregation A's administrator for a person who is also a member of congregation B is visible to B. B's `people.manage` can also end or edit it.
    - Three people on the branch belong to more than one org.
    - This is not a new class, because the single email already behaves this way. But "work address" makes it more visible.
    - Record it as an accepted residual and a follow-up, not a fix here, since scoping per org changes the table's design (D-level).

11. **`person_identifiers` is a separate system, and it stays separate.**
    - The branch shows the drift: all 24 email contact rows lack an identifier, and 13 identifiers lack a contact row. Nothing app-side keeps them in sync.
    - Resolution: the form never writes `person_identifiers`. A church typing an address is not proof of control. That is the whole point of `is_verified`.
    - Follow-ups to track:
      - Giving link proposals only see identifiers, so they never match an address typed on the form.
      - A verified identifier for an address the person has since removed still points matching at them (including across orgs). It has no `ended` column, so ending an address should unverify or flag it.

12. **Phones and the `kind` CHECK.** There is no CHECK on `kind`. Add one (email or phone), since the new indexes key on `kind='email'`.

13. **No importer exists.** Say so in the work-log, so a future importer is built against the same write path and constraints. Seed fixtures (`scripts/seed-dev.sql`, `test-rls.sql`, `invitation-fixture.ts`) need rows with `ended_at` and a person with two addresses.

14. **Mobile (360px).** The list editor stacks each address as a card: field, a label select, the main-address radio, and a remove button with a `min-h-11` tap target. Removing a row uses the shadcn `AlertDialog` (no native confirm). The form needs `HydrationGate`, which it already has, kept at the root.

## Pass 5 — Adversarial Pass

| Probe | Finding |
|---|---|
| **Open redirect / callback params** | None in this feature. The form posts to a server action and returns to the same card. Gap if the action accepts a `next`: it must not. |
| **State-machine shortcuts** | A `people.manage` holder can POST an edit directly without the UI. All rules (one primary, duplicate within person, shape, `primary_required`) must be server-side and inside the transaction. The DB unique index is the backstop for two concurrent saves. |
| **Enumeration** | The shared-address note and the not-found response run on the RLS connection only, so they reveal nothing outside the org. No cross-org duplicate check, as above. `not_found` stays identical for "missing" and "other org's person". |
| **Input boundaries** | Empty list, overlong string (cap at 254), whitespace, mixed case, Unicode or IDN domains, address with a display name or comma list ("a@x, b@y"). The shape CHECK must reject a value containing whitespace or a comma. Validate server-side. A duplicate row in one submission (the same address twice) must be refused, not passed to the unique index to raise a database error. |
| **Self-targeting** | A `people.manage` holder editing their own person row is allowed. Adding an address changes no login, because contact emails authenticate nothing, so this gives no new reach. Add a source-scan test that password reset and sign-in never read `contact_methods`. |
| **Planting an address for an invitation** | An administrator adds a mailbox they control to an unlinked, authority-free person, then invites that person. This is 2b's already accepted residual R21, detected by audit. The new audit events make the add visible. Note: acceptance passing any active address (R27) means a work address added after sending still lets an older link through. That is R27's existing "any on-file address" rule and is intentional, but the ended-row filter (Gap 3) is what keeps it from being exploited by a removed address. |
| **Resurrection** | Ending then re-adding the same address must produce a new row with `verified_at` cleared. It must not revive the old verified row. |
| **Ended address in a hidden surface** | An ended address must not appear in any reader. The source-scan test in Gap 3 is the control. |
| **Audit leakage** | Audit metadata carries row ids and labels, never address values. |
| **Sharing a work address across staff** | Two staff with `office@` as Work makes treasurer-invite matching ambiguous (correctly refused) but also means whoever controls the mailbox could accept an invitation addressed to either. 2b already refuses a shared **primary** (`address_shared`). Recommend the UI warn when the same address is on two people. |

## Edge cases the request left silent

- **2FA gate:** `/o/*` is already behind the proxy's 2FA check. Nothing here changes it.
- **Empty state (brand-new install):** zero people, zero addresses. The list editor shows one blank row (the wizard) or "No email address. Add one." (the card).
- **Failure microcopy:** a database error shows "We couldn't save. Nothing was changed." and keeps the form values. It never shows a raw database error (such as a unique-violation message).
- **A person with zero primary but several active addresses** can't be created by the form. It can exist only from legacy or imported data. The migration should repair it deterministically (promote the oldest active) or the new CHECK-by-app rule will refuse every future edit of that person.

## Data on the pipeline branch (read-only, aggregates only)

These are the dev-seed counts, with no values read.

| Measure | Count |
|---|---|
| People | 685 (all unmerged) |
| People with a linked account | 20 |
| Email rows | 24, all on distinct people (every one has exactly one row) |
| People with more than one email row | **0** |
| People with exactly one primary | 24 of 24 |
| People with several primaries | 0 |
| People with several emails and no primary | 0 |
| People with no email at all | 661 |
| Email rows: `subtype` home / null | 11 / 13 |
| Email rows with `do_not_contact` / `verified_at` set | 0 / 0 |
| Same normalized address on two people | 1 address (2 people) |
| Duplicate address within a person | 0 |
| Bad shape / untrimmed or mixed-case | 0 / 0 |
| Phone rows | 10 |
| `person_identifiers`, kind email | 13 (2 shared, 13 verified) |
| Email contact rows with no matching identifier | 24 |
| Identifiers with no matching contact row | 13 |
| Linked accounts whose account email matches a contact email | 3 of 20 |
| People in more than one org | 3 |
| Open staff positions whose person has an email | 0 |
| `person_privacy.hide_email` set | 0 |

**Production was not measured.** Before any index or CHECK ships, the orchestrator or operator should run this read-only against production and record the counts, since the unique primary index fails on any person with two primaries:

```sql
select count(*) filter (where np > 1) as several_primaries,
       count(*) filter (where np = 0 and n > 0) as none_primary,
       count(*) filter (where n > 1) as multi_row
  from (select person_id, count(*) n, count(*) filter (where is_primary) np
          from contact_methods where kind = 'email' group by person_id) x;
```

## Out of Scope (confirm with user)

- Self-service editing of one's own addresses (the member `/account` page). The account email stays separate and unchanged.
- Per-address privacy toggles on the member directory.
- Publishing a staff work address on the public staff directory.
- Wiring any new sender, newsletters, or event notices.
- Hard-bounce handling.
- Syncing addresses into `person_identifiers`.
- Per-org scoping of contact data.
- Phone multi-number UI (the soft-end change still covers phones).

## Operator Questions (few, each with a default)

1. **Labels and the main address.** Personal, Work and Other, with one address marked "Main", and the main address is the only one members see in the directory (default). Alternative: let a staff person's Work address show in the member directory even when their Personal one is main.
2. **Which address do sends use?** Default: the main address decides every send for now, which is exactly today's behavior, and the routing table above is recorded as a follow-up. It would be built when the first role or personal sender exists (for example, work address for staff role mail, never a work address for giving).
3. **Removing the main address while others remain.** Default: the administrator must pick the new main in the same save, with no silent auto-promotion. Alternative: auto-promote the oldest remaining address.
4. **The same address on two people.** Default: allowed with a non-blocking note ("Also on file for Name"), since households share. Alternative: refuse.
5. **Self-service.** Default: no, administrators only for now.

## Handoff to the architect (Phase 2)

Please rule on:
- the soft-removal column on a global table, and revoking `delete` from `presby_app`;
- the migration-number swap with 2b (Gap 4);
- the fix-forward of the four shipped 0059 reader sites plus the TS readers, with the source-scan test (Gap 3);
- where the single email resolver lives and that it is read by 2b's definers too;
- the global-table visibility residual (Gap 10).

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete. Five-pass review; 14 gaps; 5 operator questions with defaults; data measured on the pipeline branch, production pre-flight query supplied | READY WITH NOTES | 2026-10-23 |

**Next agent:** architect (Phase 2), carrying Gaps 1 to 4, 10 and 11 and the send-path table as inputs.

Files read (all under `/Users/cshenso/git/presby-platform/presby-emails/`): `docs/work-log/2026-10-23-person-emails.md`, `docs/work-log/2026-10-22-founding-admin-directory.md`, `src/lib/people.ts`, `src/lib/directory.ts`, `src/lib/community.ts`, `src/lib/onboarding/issue.ts`, `src/lib/db/domain/people.ts`, `src/lib/db/domain/privacy.ts`, `src/lib/giving/link-proposals.ts`, `src/lib/giving/statements.ts`, `src/lib/tickets-notifications.ts`, `src/lib/domains/notify.ts`, `drizzle/0009_presby_rls.sql`, `drizzle/0028_presby_people_write_rls_fix.sql`, `drizzle/0059_presby_account_invitations.sql`, and `src/app/(public)/site/[slug]/staff-directory.tsx`.

---

## Operator rulings on the Phase 1 questions (2026-10-23)

- **Q1, directory:** **"Main plus staff work email."** Members see the Main address. A person with an open staff position also shows their Work address in the member directory, even when Personal is Main. `hide_email` still hides both.
- **Q2, sending:** **"Build per-purpose rules now."** The routing contract (credential / role / personal, with `do_not_contact` skipped) is built in this pipeline as one pure function and one SQL reader. Every existing send path is wired to the rule for its purpose class, rather than deferring routing until the first new sender.
- **Q3, removing the Main address:** **"Promote the oldest automatically."** When the Main address is removed and others remain, the oldest remaining active address becomes Main without asking. The audit row records the promotion (`primary_changed` with `automatic: true`). This overrides the analyst's no-auto-promotion default. Phase 3 should still make the change visible to the admin, for example "Now the main address: …" in the save toast.
- **Q4, the same address on two people:** **allowed, with a note** ("Also on file for {Name}"), checked within the current organization only.
- **Q5, self-service:** not asked. The default stands: administrators only.
- **Production pre-flight (orchestrator, read-only, 2026-10-23):** production has 0 `contact_methods` rows in total, so 0 people with several primaries, none with no primary, and none with several rows. The new indexes and CHECKs apply cleanly.

---

# Phase 2 — Architectural Review (architect)

*To be recorded verbatim by the orchestrator. I wrote nothing. My only database access was read-only (`default_transaction_read_only=on`) against the pipeline branch endpoint `ep-winter-leaf-axct4hlj`. Nothing touched production or `development`.*

## Verdict

**Approved with suggestions.**

The feature shape is right, and the operator's rulings can be built without a structural change. Reading the live catalog turned up one premise the Phase 1 text does not state: **`contact_methods` has no `created_at` column.** So "promote the oldest remaining address" (the operator's Q3 ruling) cannot be built on today's table. The current readers' `order by is_primary desc, id` sorts by a random UUID. This pipeline's migration adds the column (F210). The catalog also showed that `presby_platform` holds DELETE on the table as well as `presby_app` (the F38 grant residue), and that the in-place value edit leaves `verified_at` asserting proof for a mailbox it never proved (F214).

The rulings below are numbered **ER1–ER24** so they don't collide with Community's R-numbers.

## Placement

- **Directory placement: a new module, `src/lib/contact-methods/`.** This is an architectural entry (DECISION-216).
  - `normalize.ts` is pure, with no `server-only` and no runtime imports. It holds `normalizeEmail()`, `isValidEmailShape()` (mirroring the SQL CHECK exactly) and the `EMAIL_SUBTYPES` and `PHONE_SUBTYPES` vocabularies.
  - `email-routing.ts` is pure. It holds `EMAIL_PURPOSES = ['credential','role','personal']`, `chooseEmail(active, purpose)`, `nextPrimaryAfterRemoval(active)`, and the one ordering constant they share.
  - `email-audience.ts` is pure. It is a closed `Record<templateKey, Audience>` registry (ER14).
  - `sql.ts` is server-only. It exports the RLS-side SQL fragments for the active-primary lateral and the staff-Work lateral. `directory.ts`, `community.ts` and the card then share one copy of the `ended_at` predicate and the order.
  - `store.ts` is server-only. It is **the only writer of `contact_methods`** in `src/`, for both kinds: add, end, replace, set primary, relabel, set `do_not_contact`. It runs inside the caller's `withOrgContext` transaction and writes its audit rows with `insertAuditRow` in that same transaction. `updatePerson()` and `createPerson()` call it; `upsertPrimaryContactMethod` is deleted. This follows the `domains/service.ts` "only writer" precedent.
  - `reader.ts` is server-only. It is a thin wrapper over the SQL reader (ER11) for senders.
- **SQL:** one migration, **0064** (ER2). There is a staged suite, `scripts/person-emails/test-rls-64.sql`, run as `presby_app` (Rule 16: `test-rls.sql` is patched at integration only).
- **Server vs Client split:**
  - The edit form is already a client `useForm` root with `<HydrationGate>`. The address list becomes a `useFieldArray` inside that same root, with no second form root.
  - Removing an address uses the generated `AlertDialog`, with no native `confirm`.
  - The Community card, the directory and the find-person results stay Server Components.
  - The wizard's list editor is the same client component, reused.
- **Dependencies:** none. Validation is a regex mirrored from the CHECK; zod is already present. No new package.

## Rulings on the analyst's handoff items

### 1. Soft removal, delete revoked, edit means end-and-replace

- **ER1. Columns.** Add `created_at timestamptz not null default now()` (F210) and `ended_at timestamptz` (null means active). **No `ended_by`.**
  - The audit row is written in the same transaction (ER20), and it is the authoritative "who".
  - An FK from this global person table to `users` would add a second identity edge for no gain.
  - Existing rows get the migration timestamp. The order is always `(created_at, id)`, so ties are deterministic. Production has 0 rows; the branch is dev data.
- **ER1a. One shared order.** Wherever "oldest" or "first" is needed: `is_primary desc, created_at, id` for display, and `created_at, id` for promotion. The constant lives in `email-routing.ts` and is mirrored in SQL. A test pins the two.
- **ER1b. Revoke DELETE from `presby_app` and `presby_platform`.** There is **no BEFORE DELETE trigger.**
  - `presby_guard_people_delete` says in its own comment (0048) that a delete guard on any of `people`'s six cascade children forces arming in that function.
  - The `deletable_until` fixture cascade and the e2e fixture deletes (`e2e/support/community-fixture.ts:187`, `invitation-fixture.ts:316`) run as the owner and stay unaffected.
  - The owner path is a `paper` residual. Its mitigation is a source scan: no `delete(contactMethods)` or `delete from contact_methods` in non-test `src/`.
- **ER1c. A guard makes end-and-replace a database property.** Add `contact_methods_guard_write`, an invoker function on BEFORE INSERT OR UPDATE that binds every role. It refuses:
  - any change to `value`, `kind`, `person_id` or `created_at`;
  - any change to a row whose `ended_at` is already set (an ended row is frozen, so there is no un-ending and no re-dating);
  - a non-owner setting or changing `verified_at` on insert or update. It uses the A1 idiom: `pg_class.relowner` for `TG_RELID` compared with `current_user`'s oid, with no role named. Only the acceptance definer proves an address. A replacement or a re-added address therefore always starts unverified (F214, and the "resurrection" probe).
  - Phase 3 measures fixture writers first. The grep finds only `update … set do_not_contact` (`issue.db.test.ts:497`), which stays legal.
- **ER1d. CHECK `ended_at is null or not is_primary`.** Ending the primary clears the flag in the same statement. Promotion is a separate, explicit write.
- **ER1e. In-place changes are limited** to `subtype`, `do_not_contact`, `is_primary` and the end itself (null to a timestamp).
  - A typo fix ends the row and inserts a new one. My lean: it carries the label but not `do_not_contact` or `verified_at`. Phase 3 decides `do_not_contact`.
  - Phones follow the same path. That closes the `contact_methods` arm of F176. **F176 stays open** for `addresses` (`people.ts:941`) and the other tables it lists, so the release note must not claim otherwise.

### 2. Migration numbering, and running in parallel

- **ER2. Numbers:**
  - Increment 2 keeps **0062** and **0063**. Its staged suite is already named `test-rls-62.sql`, and 0063 is the post-deploy lockdown, so renumbering it costs the most.
  - **This pipeline takes 0064.**
  - **2b moves to 0065.**
  - The intended merge order, which is also the numeric order: **Increment 2, then emails, then 2b.**
  - No swap. Increment 2 has written no `0062` file yet (checked in `presby-fadir`), but it is two phases ahead and will normally merge first. If emails is ready first, it waits for Increment 2's merge; Rule 16 serializes integration anyway. Only the operator, explicitly, can choose a swap.
- **ER2a. Increment 2 and emails may run Phase 4 in parallel.**
  - Their SQL objects don't overlap. Increment 2 changes `roll_actions`, `officer_terms`, groups and grants. Emails changes `contact_methods` and re-creates preview and accept, which Increment 2 doesn't touch.
  - They do share code files outside Rule 16: `src/lib/people.ts`, `src/lib/audit.ts`, `community/new/*` and `community/[id]/edit/page.tsx`. Emails merges second, so it rebases and resolves.
  - At integration, before 0064 runs on `development`, the orchestrator diffs `pg_get_functiondef` for `presby_preview_invitation` and `presby_accept_invitation` on `development` against the emails branch. They must be identical.
- **ER2b. 2b's Phase 4 starts after emails merges.** Its SQL references `ended_at` and the reader. Its design text must change from 0064 to 0065, including `test-rls-64.sql` becoming `-65`. Its "derive bodies from the LIVE definitions" rule already covers re-creating the functions emails will have just replaced.
- **ER2c. One migration, applied before the code deploy.** The column must exist before the code, and the revoke would ideally follow it. I checked every way the old code meets the new schema, and each one fails closed:
  - a mixed-case insert fails the CHECK (old code doesn't lowercase);
  - an in-place value update fails the guard;
  - a blank-field delete fails the revoke.

  No row is corrupted, production has 0 rows, and the window lasts minutes. A second lockdown number isn't worth it. The deployment runbook and the release note carry this paragraph.

### 3. Fix-forward of the shipped readers, and the scan

- **ER3. 0064 re-creates `presby_preview_invitation` and `presby_accept_invitation`** from the live definitions, with signatures unchanged so their ACLs survive. It adds `and cm.ended_at is null` at the four sites and changes nothing else:
  - the preview's address match;
  - accept's match count;
  - accept's `limit 1` select;
  - accept's `verified_at` update.

  The live catalog confirms these are the only functions that read `contact_methods`; `presby_guard_people_delete` names it in a comment only. The FA and treasurer parity golden must stay byte-identical. This is F211. Without it, a removed address would still resolve a founding-administrator or treasurer acceptance and still receive `verified_at`. Today a removed address is deleted, so this pipeline would *introduce* that regression.
- **ER3a. TypeScript readers.** `issue.ts`'s `resolveTreasurerPerson` and `hasDoNotContact` gain the predicate; an ended row with `do_not_contact` must not warn. `people.ts`'s edit-form read becomes a list of active rows. `directory.ts` and `community.ts` move to the `sql.ts` fragments.
- **ER3b. Scan.** A file-level "names `contact_methods`, so it must name `ended_at`" check is satisfied by one mention, so I'm strengthening it into three controls:
  - **TS allow-list.** Under non-test `src/`, only `src/lib/contact-methods/*`, `directory.ts`, `community.ts`, `people.ts` and `onboarding/issue.ts` may name `contact_methods` or `contactMethods`. Each must also name `ended_at` or import from `contact-methods/sql`. Comment-only files (`children.ts`, `staff-directory.tsx`, `dev-docs.ts`) carry `// contact-methods-scan-ok: <reason>`.
  - **Catalog DB test.** It runs `select proname from pg_proc where prosrc ilike '%contact_methods%' and prosrc not ilike '%ended_at%'` minus an allow-list of `presby_guard_people_delete`. Historical migrations are immutable, so the live catalog is the right target for SQL.
  - **Behavioural tests per site.** An ended address must not appear in the preview, must not resolve at accept, must not get `verified_at`, must not match a treasurer, and must not trigger the `do_not_contact` warning. These tests are the real control; the scans are tripwires.

### 4. Where the resolver and routing live, and how 2b uses them

- **ER11. SQL reader.** `presby_person_email(p_person_id uuid, p_purpose text) returns table (contact_method_id uuid, address text, subtype text, do_not_contact boolean)`, returning zero or one row.
  - It is `language sql stable`, **security invoker**, with `set search_path = public, pg_temp`. It does `revoke all from public, presby_platform` and `grant execute to presby_app`.
  - Being invoker, it adds no authority and does no scoping. On `presby_app` it sees what RLS shows. Called from inside a definer, it sees what the definer has already scoped.
  - An unknown purpose raises `internal_error`, following R35's explicit-routing rule.
- **ER12. Purpose rules,** stated as filter then order, with the same text in SQL and TypeScript:

  | Purpose | Filter | Order | `do_not_contact` |
  |---|---|---|---|
  | `credential` | the active primary | — | returned, not skipped. The caller acknowledges it, matching 2b's check 10. |
  | `role` | active, not `do_not_contact` | `subtype = 'work'` first, then `is_primary desc, created_at, id` | skipped |
  | `personal` | active, not `do_not_contact`, `subtype` not `work` (null counts as non-work) | `is_primary desc, created_at, id` | skipped |

  - A matrix DB test runs the same fixture rows through `chooseEmail()` and the SQL reader and asserts identical output. **SQL is authoritative for any credential**: R20's address is read in SQL and never trusted from TypeScript. TypeScript is for UI previews and for senders that already hold RLS-read rows.
- **ER13. 2b's consequences** (folded into its Phase 3; my addendum rulings stand otherwise):
  - The issue and resend core call `presby_person_email(person, 'credential')`. No row means `no_email_on_file`.
  - **`address_ambiguous` becomes unreachable and is dropped from `SIGN_IN_REFUSALS`.** ER15 makes "exactly one active primary" a database property, and an unreachable pinned literal can't be tested.
  - R27, `address_current` and R29 `address_shared` all gain `ended_at is null`. "Any on-file email" now means any *active* email.
  - R27's `FOR SHARE` reasoning still holds. Ending an address is a non-key UPDATE, so it blocks on the share lock, and READ COMMITTED's re-check finds the row ended and returns `dead`.
  - **S9's index moves here.** 2b removes `contact_methods_email_norm_idx` from its migration.
  - The `do_not_contact` acknowledgement reads the flag the reader returns.
  - 2b's `address_invalid` (320 characters) stays as a defensive branch. ER16's 254-character shape is a strict subset of `account_invitations_email_shape`, so every contact address can always be inserted as `email_normalized`. A test pins that subset.
- **ER14. "Wire every send path" (operator Q2) becomes a closed audience registry.**
  - `email-audience.ts` maps every `templateKey` literal in `src/` to one of: `account` (`users.email`, never `contact_methods`), `typed`, `donor`, or `person:<purpose>`.
  - A source scan fails on any template key that isn't classified. So the "which address" question is asked mechanically for every future sender.
  - Today's classification:
    - `password_reset`, `email_change_verify`, `feedback_notification`, the `ticket_*` keys and `domain_notification` are `account`.
    - `account_invitation`, `treasurer` and `statistics_submission_grant` are `typed`. Matching to a person uses active addresses (ER3).
    - The giving statement notice is `donor`.
    - 2b's `account_sign_in_invitation` is `person:credential`.
  - **Giving is the only existing path where wiring would change behaviour:** falling back to `personal` for a linked donor with no donor email. I'm allowing it only on these conditions:
    - at statement-snapshot time only, so the address is frozen into `delivery_email`;
    - linked donors with a null donor email only;
    - only through `contact-methods/reader.ts`, never by naming `contact_methods` inside `src/lib/giving`;
    - never a Work address.

    If Phase 3 can't specify the copy and flow without the analyst, it files a TODO rather than inventing them. Giving is tier 2, and a new recipient is a functional decision.
  - **Auth paths never read contact emails.** This is a source scan over `src/auth.ts`, `src/lib/auth/`, `(auth)`, `(password-reset)`, `(email-verify)` and `api/auth`.

### 5. Database enforcement

- **ER15. Primary:**
  - **At most one:** a unique index on `(person_id, kind) where is_primary and ended_at is null`. It covers phones too; the branch has 0 phones with several primaries.
  - **At least one**, for email: a `DEFERRABLE INITIALLY DEFERRED` constraint trigger. It is **SECURITY DEFINER** (F26: it must count every row the person has, whatever org context or RLS view the caller has), with a pinned `search_path`. At commit it refuses a person who has active email rows and no active primary. It only checks; it never writes.
  - Together they make "exactly one active primary whenever any active email exists" a database property, and 2b relies on that.
  - Partial unique indexes can't be deferred, so the store must demote or end the old primary before it promotes the new one.
- **ER16. Shape:**
  - `kind in ('email','phone')`.
  - For email: `value = lower(btrim(value)) and char_length(value) <= 254 and value ~ '^[^@[:space:],]+@[^@[:space:],]+\.[^@[:space:],]+$'`. This allows exactly one `@` and rejects whitespace and commas, which kills `"a@x, b@y"`.
  - For phone: `value = btrim(value) and value <> ''`.
  - **Normalize on write** (the `account_invitations` and `giving_donors` precedent). Stored values are already normalized, so every existing `lower(btrim(cm.value))` comparison keeps working unchanged.
- **ER17. Uniqueness within a person:** a unique index on `(person_id, lower(btrim(value))) where kind = 'email' and ended_at is null`.
  - Re-adding an ended address inserts a new row.
  - Duplicates within one submission are refused in the store before they reach the index.
  - The global lookup index (S9) is `(lower(btrim(value))) where kind = 'email' and ended_at is null`.
- **ER18. Subtypes.**
  - Email: `personal`, `work`, `other`, or null (shown as "Email").
  - **Store `personal`, and migrate `home` to `personal`** for `kind = 'email'` in 0064, before the CHECK. It is a label change, so updating in place is legal.
  - Phone keeps `mobile`, `home`, `work`, or null.
  - A per-kind CHECK enforces both.
  - `scripts/seed-dev.sql` and `scripts/invitations/seed-dev-invitations.sql` must be updated at integration to write normalized values (`lower(btrim(u.email))`) and the new labels, or a re-seed fails the CHECK.
- **ER19. Applying the constraints.** Production has 0 rows and the branch measures 0 violations. So 0064 runs a **stop-block** that counts, without ever selecting a value: bad shape, untrimmed or mixed-case values, unknown kind or subtype, several primaries, duplicates within a person, and active emails with no primary. Any non-zero count raises. Then it adds each CHECK `NOT VALID` and runs `VALIDATE` in the same file. Every other environment is still guarded by the stop-block.
- **ER19a. Auto-promotion is done by the application, not a trigger.**
  - `store.ts` uses `nextPrimaryAfterRemoval()`: the oldest active row by `(created_at, id)`, whatever its label. It writes the promotion and the audit row with `automatic: true`, and returns the promoted row so the toast can say "Now the main address: …".
  - A writing trigger couldn't hand the promoted row back to the action, and it couldn't write a typed audit row in the same transaction.
  - ER15's deferred check is the backstop if any writer forgets.
  - A posted submission with active addresses and no primary is normalized by the same rule, giving one rule and not two. More than one primary is an input error.
  - The store takes `people … FOR UPDATE` before touching any contact row. That serializes concurrent saves and keeps R27's lock order (person before contact).
  - **Named tension:** auto-promotion can make a Work address the Main one, so credential mail goes there. The operator ruled for this. `personal` routing still keeps giving mail away from Work whatever the Main is.

### 6. Global-table residual (Gap 10) and `person_identifiers` (Gap 11)

- **ER21. Accept and record, `paper` (DECISION-218).**
  - `contact_methods` stays global and FORCE RLS, with person-level policies. Organization B's `people.manage` can see, end, relabel or re-primary an address that organization A entered for a person who belongs to both.
  - With ER19a, B ending the Main address also changes A's routing.
  - **Bounded for credentials:** R31 refuses a `sign_in` invitation to anyone with any membership elsewhere, live or ended.
  - **Detected:** every change writes `tenant.person_email.*` with the acting `organizationId`.
  - Scoping contact data per organization is a D-level redesign and a TODO, not this pipeline. The branch has 3 people with more than one membership, all fixtures.
- **ER22. `person_identifiers` stays separate.**
  - The form never writes it. A congregation typing an address is not proof of control.
  - Ending a contact address does not touch identifiers.
  - Two TODOs:
    - unverify or flag a verified identifier whose address has been ended everywhere;
    - giving link proposals don't see contact addresses.
  - The wizard passes **all** typed addresses to `presby_match_person()`, which already takes an array.

### 7. Find-person, directory search, and the staff Work address

- **ER23. Member directory display** (operator Q1):
  - Show the active Main address.
  - Also show the active Work address when the person holds an **open staff position at the current organization**: `starts_on <= current_date and (ends_on is null or ends_on > current_date)`, read on the RLS connection. Several Work rows: take the first by `is_primary desc, created_at, id`. If the Main address *is* the Work address, show it once.
  - `hide_email` nulls both.
  - The public staff directory is unchanged. 0041's comment requires a pipeline of its own to widen it.
- **ER23a. Search matches only what is shown (F212).**
  - `findDirectoryPersonIds` and the directory's `search` match names, plus the displayed emails when `hide_email` is false, plus the primary phone when `hide_phone` is false. Ended rows never match.
  - This reverses the earlier "raw value may match" design noted at `directory.ts:153`.
  - **Admin surfaces** (Community search, gated by `people.manage`) may match every active address of the person, because the card shows them all.
- **ER23b. The "Also on file for {Name}" note** uses R29's predicate: another live, unmerged person with a **live** membership at `presby_current_org()`, on the RLS connection. RLS alone would also show people whose membership has ended. A test pins the note's predicate equal to 2b's `address_shared`. It is never checked across organizations.

### 8. Audit

- **ER20. Keys, all written with `insertAuditRow` in the save transaction:**
  - `tenant.person_email.added`: `{organizationId, contactMethodId, subtype, isPrimary, replacesId?}`
  - `tenant.person_email.ended`: `{organizationId, contactMethodId, subtype, wasPrimary, replacedById?}`
  - `tenant.person_email.primary_changed`: `{organizationId, fromContactMethodId, toContactMethodId, automatic}`
  - `resourceId` is the person id. **No address value, partial address or domain in any metadata.** A test asserts that no metadata value matches an `@`.
  - **Suggested fourth key:** `tenant.person_email.updated`, `{fields: ['subtype' | 'do_not_contact']}`. The routing contract makes `do_not_contact` decide whether an address is used.
  - Phone changes ride `tenant.person.updated` with `phoneChanged`.
  - **Moving `person.updated` into the transaction (F199) remains 2b's.** Phase 3 may pull it forward, since `updatePerson` is being rewritten anyway; if it does, it tells 2b.

## Invariants Touched

- **Isolation Is a Database Property:**
  - `contact_methods` stays FORCE RLS with unchanged policies.
  - The one trigger that must see all of a person's rows (ER15) is SECURITY DEFINER (F26). The guard (ER1c) reads nothing and stays invoker.
  - The reader is invoker and adds no authority.
  - Verified against `pg_class`, `pg_policies` and `aclexplode` on the branch.
- **Never hard-delete / all deletes are soft:**
  - DELETE is revoked from `presby_app` and `presby_platform`. Removal is `ended_at`.
  - The F176 `contact_methods` arm closes; F176 stays open for `addresses` and the rest.
  - The owner path is `paper`, mitigated by a source scan.
- **Permissions vs Flags, and credentials:**
  - No new `FEATURES.*` key: `people.manage` covers every write, and the existing read gates are unchanged. No flag: the Community toggle gates the surfaces.
  - **A contact email authenticates nothing.** It is never read by sign-in, password reset or email verification (scan). It becomes a credential's *destination* only inside 2b's definer, through the SQL reader.
- **Two Hierarchies:** no platform predicate is involved. ER21's cross-org reach is ecclesiastically flat and audited.
- **Composite Tenant Keys:** no new tenant table. `contact_methods` is a global person child; its FK to `people` is unchanged.
- **The Brand Is a Cascade Override:** unaffected. Everything is in `(org)`, which is brandable, and `(invite)`'s functions change, not its group.
- **Verify in a Browser / HydrationGate:** the list editor stays inside the existing gated root. Check at 360px: stacked cards, a `min-h-11` remove target, and the AlertDialog.
- **CLAUDE.md change, for operator review:** add a Project Layout line for `src/lib/contact-methods/`, and one sentence under Permissions vs Flags: "a contact email authenticates nothing; only a definer reading it through `presby_person_email` may address a credential to it."

## Notes (Phase 3 must honour)

1. **Measure before DDL:**
   - every owner-side and `presby_app`-side fixture that inserts `contact_methods`. Each must insert normalized values and exactly one primary per person with emails, or ER15 fails at commit;
   - every fixture that updates `value`;
   - the `subtype` values in all seeds.
2. **0064's internal order:**
   - stop-block;
   - columns;
   - the `home` to `personal` update;
   - CHECKs (`NOT VALID`, then `VALIDATE`);
   - indexes;
   - guard and deferred triggers;
   - revoke;
   - reader;
   - preview and accept replacements, last.

   Apply it twice on a throwaway branch, then run the parity golden and `test-rls.sql` before it reaches the pipeline branch.
3. **Pin by test:**
   - the SQL and TypeScript matrix (ER12);
   - the order constant;
   - the shape CHECK against `isValidEmailShape()`, and the contact shape as a subset of the invitation shape;
   - the subtype vocabularies;
   - full classification of the audience registry;
   - no addresses in audit metadata;
   - the ER23b predicate equal to R29;
   - each of the four ended-address behaviours (ER3b);
   - delete refused, value update refused, `verified_at` write refused (as `presby_app`), second active primary refused, and an ended row being primary refused.
4. **Staged for integration, not edited mid-pipeline (Rule 16):** the `test-rls.sql` patch, the `seed-dev.sql` and `seed-dev-invitations.sql` changes, the journal entry, TODO, decisions and STATE.
5. **Drizzle mirror:** `src/lib/db/domain/people.ts` gets the columns, CHECKs and indexes, plus `check:schema-parity`. Then `npm run docs:erd`.

## Suggestions (Phase 3's call)

- **S1.** Add the `tenant.person_email.updated` key (ER20).
- **S2.** Drop `contact_methods_value_idx`, the unused `lower(value)` index, once nothing plans on it.
- **S3.** Have the Community card show "Don't send mail here" and "Main" badges, so an administrator can see why a send skipped an address.
- **S4.** Pull F199 forward, since `updatePerson` is being rewritten (ER20).

## Decisions proposed (the orchestrator records them; DECISION-219 stays unassigned)

- **DECISION-215: contact methods are end-dated, never deleted, and their identity is immutable.** It covers ER1–ER1e, ER15–ER19a, the single-migration deploy (ER2c), and auto-promotion by the oldest active row, done in the application, audited, with a database backstop.
- **DECISION-216: one place decides which address a person's mail uses.** It covers the `src/lib/contact-methods/` module and its only-writer rule, the invoker SQL reader `presby_person_email` as the credential authority, the three purpose classes (ER12), the closed template-key audience registry (ER14), and the rule that contact emails authenticate nothing.
- **DECISION-217: the member directory shows the Main address plus an open staff member's Work address, and search matches only what is shown** (ER23–ER23b; this reverses the raw-value-match behaviour).
- **DECISION-218: accepted residuals.** It covers the global contact table's cross-organization reach (ER21, `paper`, bounded by R31, detected by audit) and the separation from `person_identifiers` (ER22).

## Findings (F210–F214; the rest of the range is unused)

- **F210:** `contact_methods` has no creation time. "First" and "oldest" are decided by a random UUID, so the directory shows an arbitrary address for a person with several and none primary, and the operator's promotion rule can't be built. Closed by ER1 and ER1a.
- **F211:** The four shipped 0059 reader sites, and `issue.ts`'s treasurer match and `do_not_contact` warning, would treat an ended address as on file, resolve a person by it, and stamp it verified. This is latent until `ended_at` exists, so it must be fixed in the same migration. Closed by ER3 and ER3a.
- **F212:** Find-a-person and directory search match hidden and undisplayed addresses and phones. That oracle widens with several addresses per person. Closed by ER23a.
- **F213:** There is no database constraint on `kind`, `subtype`, value shape, a single primary, or uniqueness within a person. Closed by ER15–ER18.
- **F214:** `verified_at` isn't bound to the mailbox it proved. `updatePerson()` edits the value in place, so the proof carries over to a different address, and `presby_app` can set `verified_at` directly. Closed by ER1c and ER1e.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete. ER1–ER24 ruled on all eight handoff items. Migration 0064 for this pipeline, with 2b moving to 0065 and Increment 2 keeping 0062/0063; Phase 4 may run alongside Increment 2; merge order Increment 2, then emails, then 2b. New module `src/lib/contact-methods/`; no dependencies. DECISION-215–218, F210–F214. Missing `created_at` found in the live catalog. | Approved with suggestions | 2026-10-23 |

## Handoff

**Next agent: tech-lead (Phase 3).** Design to ER1–ER24, take the Note 1 measurements first, and rule on S1–S4.

The orchestrator should:
- re-reserve the migrations: this pipeline 0064, Increment 2b 0065, Increment 2 unchanged at 0062/0063;
- update this work-log's header line ("0065 if needed") and the 2b design's references from 0064 to 0065, including `test-rls-64.sql`, and its Phase 4 gate (after emails merges);
- send 2b's tech-lead the ER13 consequences:
  - drop `address_ambiguous`;
  - every `contact_methods` predicate gains `ended_at is null`;
  - S9 moves here;
  - the credential address comes from `presby_person_email(…, 'credential')`.

Files read, all under `/Users/cshenso/git/presby-platform/presby-emails/`:
- `docs/work-log/2026-10-23-person-emails.md`, `docs/work-log/_template.md`, and `docs/work-log/2026-10-22-founding-admin-directory.md` (Increment 2's Phase 2 R19–R26 and its Phase 3 plan, 2b's Phase 2 R27–R36, and 2b's Phase 3 through the 0064 contract)
- `drizzle/0008_presby_domain.sql`, `drizzle/0028_presby_people_write_rls_fix.sql`, `drizzle/0059_presby_account_invitations.sql` (lines 850–885, 1155–1245), `drizzle/meta/_journal.json`
- `src/lib/directory.ts`, `src/lib/community.ts`, `src/lib/people.ts`, `src/lib/onboarding/issue.ts`, `src/lib/email/credential-keys.ts`, `src/lib/giving/statements.ts`, `src/lib/db/domain/giving.ts`, `src/lib/db/domain/invitations.ts`, `src/lib/audit.ts`, `src/lib/audit-tx.ts`
- `scripts/invitations/seed-dev-invitations.sql`, `src/lib/testing/invitation-fixture.ts`
- `/Users/cshenso/git/presby-platform/presby/docs/deployment.md` (Migrations)

Live catalog read on `ep-winter-leaf-axct4hlj`, read-only:
- `contact_methods`: columns, constraints, indexes, triggers (none), policies, `aclexplode` grants;
- RLS flags on `contact_methods`, `person_identifiers`, `staff_positions` and `person_privacy`;
- the `presby_guard_people_delete` body;
- every `pg_proc` body that names `contact_methods`;
- the `staff_positions` and `person_privacy` columns;
- aggregate counts by kind and subtype, shape, primaries and multiple rows. No values were selected.

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
