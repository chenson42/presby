# Hide members-only events from visitors — Work Log

> **Slug:** `2026-11-02-members-only-events`
> **Surface:** (org) member calendar (`/o/<slug>/calendar`, the event page, the `/o/<slug>` "Coming up" card), and any other member-side event read
> **Permission(s):** existing `events.view`; no new key
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** to be confirmed by the tech-lead. Full Feature if the filter belongs in SQL (a definer, RLS or a migration); Accelerated Feature if it is a read-side change only.
> **Numbers (pre-assigned):** F418; DECISION-316; migration 0085 if needed; port 3630; Neon `pipeline-members-only-events` (`br-wispy-heart-axabgzsj`)
> **Source:** Community 3a live walk, N1 (`docs/work-log/2026-10-22-founding-admin-directory-inc3.md`, "Phase 6 addendum — live walk"). Operator ruling 2026-11-02: **"hide them from visitors"**.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Brief: the behaviour and the operator's ruling are below; the tech-lead may ask for a full Phase 1 if the scope is wider than it looks | Ruled by operator | 2026-11-02 |
| 2 — Architectural review | architect | Pending tech-lead's call | — | — |
| 3 — Technical design | tech-lead | In progress | — | — |
| 4 — Implementation | TBD | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

## Phase 1 (brief, orchestrator, from the analyst's N1 and the operator's ruling)

**What happens today.**
- An event with "Open to everyone, not only members" unticked (`is_public = false`) appears on a connected visitor's member calendar, in their `/o/<slug>` "Coming up" card, and on its event page, tagged "Members only".
- `calendar.ts` records that `is_public` is not a member filter (operator ruling 4). Visitors held `events.view` before 0066 too; 0066 made "everyone with a current record sees the calendar" explicit, through the Calendar viewer role.
- "Copy month" already leaves members-only events out ("Calendar copied (1 members-only event left out)").
- The help page `events-and-the-calendar` says an unticked event "shows only on the member calendar, for members who have calendar access", which a reader takes to exclude visitors.

**Operator ruling (2026-11-02).** Hide members-only events from **visitors**.

**Scope note from the orchestrator.** The ruling names visitors. People marked inactive or moved away (also without member standing) are not named. The tech-lead should state what the design does for them and why, and raise it rather than widen the scope silently.

**User verbs.**
- A connected **visitor** opens the calendar, the "Coming up" card or a direct event link. They never see a members-only event; a direct link answers the same way a missing event does, without saying it exists.
- A **member** (member standing) sees what they see today.
- An **administrator** creating an event sees the "Open to everyone, not only members" label and help that say who sees an unticked event.

**Help impact.** `events-and-the-calendar` (the member-calendar sentence; also the N2 phone sentence while there, already a TODO line). Possibly the event form's label copy.

**Edge cases to settle in Phase 3.**
- A recurring series.
- An event that changes from public to members-only while a visitor has its page open.
- The event's RSVP or sign-up surfaces, if any exist today.
- The public website (unchanged: it shows only website-listed events).
- The `/o/<slug>` home card count.
- A person who is both a visitor here and a member elsewhere (per-organization standing).
- A platform admin with no membership.
