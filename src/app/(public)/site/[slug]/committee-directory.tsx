import { PersonCard } from "presby-site-kit";
import {
  getPublicCommitteeRoster,
  type PublicCommitteeRosterEntry,
  type PublicCommitteeRosterFilter,
} from "@/lib/sites";

/**
 * `/site/<slug>`'s `committeeDirectory` live slot (docs/work-log/
 * 2026-08-28-public-directory-primitives.md, Phase 3/4) — a plain `async`
 * Server Component, co-located with and following `staff-directory.tsx`'s
 * own conventions exactly: no `"use client"`, the read happens once at
 * render time, on the server. See that file's own header for the shared
 * `liveSlots` resolver-function/filter-narrowing rationale (presby-site-kit
 * v4.0.0, DECISION-132) — not repeated here.
 *
 * ONE CALL SHAPE ANSWERS BOTH "one committee's page" and "an all-committees
 * page" (Phase 3 Design Decision 2) — which one a given marker instance
 * renders is entirely a function of what its own `filter` contains:
 *   - `{"committee": "Missions Committee"}` -> that committee's currently
 *     public members only.
 *   - `{}` (or a marker with no `filter` key at all) -> every currently
 *     public committee's members, in one flat, `groupName`-tagged list this
 *     component groups sequentially into one `<section>` per committee. A
 *     single-committee filter still renders through the exact same grouping
 *     code path (one group, one heading) — no separate "no heading needed"
 *     special case, so there is only one render path to verify, not two.
 *
 * FIELD SCOPE IS ENFORCED HERE VIA `PersonCard` ITSELF, NOT JUST AT THE SQL
 * LAYER — `PersonCard`'s own prop type structurally carries no
 * `phone`/`email` fields to set in the first place (Phase 3 Design Decision
 * 3), so unlike `staff-directory.tsx`'s `StaffPerson` mapping this isn't "a
 * caller discipline to remember," it's a type error waiting to happen if
 * anyone tried.
 *
 * EMPTY RESULT GETS ITS OWN EXPLICIT BRANCH, matching
 * `PublicStaffDirectory`'s own precedent exactly — never a silent blank,
 * whether the flag is off, nobody has opted in yet, or a filter narrows to
 * zero rows.
 *
 * `PersonCard` SHIPS WITH NO CSS OF ITS OWN in presby-site-kit v4.0.0 (a
 * genuinely net-new component — unlike `StaffList`, which already has
 * `[data-block="staff-list"]` rules in the sibling repo's stylesheet).
 * Styled entirely through `PersonCard`'s own `className` prop here
 * (`PERSON_CARD_CLASSNAME` below), reusing the SAME auto-fit card-grid
 * treatment (`repeat(auto-fit, minmax(15rem, 1fr))`, 1.5rem gap)
 * presby-site-kit's own stylesheet already applies to `StaffList`/
 * `FeatureGrid`/`ValuesGrid`/`MinistryList`/`EventList`, so a committee
 * section looks visually consistent with the rest of the page without
 * touching the sibling repo at all. Verified in a real browser at 360/390px
 * and desktop (Phase 1/3's own "PersonCard's mobile pass is net-new,
 * explicitly required" note) — see the work-log's Phase 4 step 5/6 section.
 */

const GROUP_ROLE_LABELS: Record<"chair" | "leader" | "member", string | undefined> = {
  chair: "Chair",
  leader: "Leader",
  // "Member" is the redundant common case — matches StaffPerson.title's own
  // "optional, omit it" prior art; PersonCard renders no <p> at all for it.
  member: undefined,
};

/**
 * `PersonCard` renders `<img>`/`<p data-slot="title">` as direct children of
 * its own root `<div>` with no CSS of their own (see header) — targeted here
 * via Tailwind's child-combinator arbitrary variants (`[&>img]`, `[&>p]`)
 * rather than reaching into the sibling repo for a one-page's-worth of CSS.
 * `headingClassName` (a real `PersonCard` prop, unlike `<img>`/`<p>`) styles
 * the name directly instead of a third selector.
 */
const PERSON_CARD_CLASSNAME =
  "rounded-lg border border-border bg-card p-6 text-center [&>img]:mx-auto [&>img]:mb-3 [&>img]:h-20 [&>img]:w-20 [&>img]:rounded-full [&>img]:object-cover [&>p]:mt-1 [&>p]:text-sm [&>p]:text-muted-foreground";

const PERSON_CARD_HEADING_CLASSNAME = "text-base font-medium";

function parseCommitteeRosterFilter(
  raw: Record<string, unknown>,
): PublicCommitteeRosterFilter {
  const filter: PublicCommitteeRosterFilter = {};
  if (typeof raw.committee === "string") {
    filter.committee = raw.committee;
  }
  if (typeof raw.hasPriority === "boolean") {
    filter.hasPriority = raw.hasPriority;
  }
  return filter;
}

interface CommitteeGroup {
  groupName: string;
  members: PublicCommitteeRosterEntry[];
}

/**
 * One sequential bucketing pass, never a re-sort —
 * `presby_public_committee_roster()`'s own `ORDER BY group_name, ...`
 * already clusters same-name rows contiguously (Phase 3 Design Decision 2),
 * so adjacent rows sharing a `groupName` are always the same committee.
 */
function groupByCommittee(
  entries: PublicCommitteeRosterEntry[],
): CommitteeGroup[] {
  const groups: CommitteeGroup[] = [];
  for (const entry of entries) {
    const current = groups[groups.length - 1];
    if (current && current.groupName === entry.groupName) {
      current.members.push(entry);
    } else {
      groups.push({ groupName: entry.groupName, members: [entry] });
    }
  }
  return groups;
}

export async function PublicCommitteeDirectory({
  slug,
  filter,
}: {
  slug: string;
  filter: Record<string, unknown>;
}) {
  const entries = await getPublicCommitteeRoster(
    slug,
    parseCommitteeRosterFilter(filter),
  );

  if (entries.length === 0) {
    return <p>No committees have been listed here yet.</p>;
  }

  const groups = groupByCommittee(entries);

  return (
    <div className="space-y-10">
      {groups.map((group) => (
        <section key={group.groupName}>
          <h2 className="text-xl font-semibold">{group.groupName}</h2>
          <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-6">
            {group.members.map((member, index) => (
              <PersonCard
                // No id is ever exposed in this projection (Design Decision
                // 2) — name+role+index is the best available key, matching
                // StaffList.js's own array-index-key precedent one layer
                // down in the sibling repo.
                key={`${group.groupName}-${index}`}
                name={member.displayName}
                title={GROUP_ROLE_LABELS[member.groupRole]}
                photoUrl={
                  member.photoKey
                    ? `/site/${slug}/assets/${member.photoKey}`
                    : undefined
                }
                className={PERSON_CARD_CLASSNAME}
                headingClassName={PERSON_CARD_HEADING_CLASSNAME}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
