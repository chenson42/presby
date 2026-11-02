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
| 2 — Architectural review | architect | Pending tech-lead's call: skipped if the fix touches no invariant | — | — |
| 3 — Technical design | tech-lead | In progress | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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
