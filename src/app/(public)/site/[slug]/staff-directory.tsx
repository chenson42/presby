import { StaffList, type StaffPerson } from "presby-site-kit";
import { getPublicStaffRoster, type PublicStaffRosterFilter } from "@/lib/sites";

/**
 * `/site/<slug>`'s `staffDirectory` live slot (docs/work-log/
 * 2026-08-27-public-staff-directory.md, Phase 3/4; filter widening in
 * docs/work-log/2026-08-28-public-directory-primitives.md, Phase 3/4) — a
 * plain `async` Server Component, co-located exactly like `contact-form.tsx`
 * (this route's other per-feature component), but with NO `"use client"`:
 * unlike `ContactForm`, this component submits nothing and needs no event
 * handlers, hooks, or browser APIs — the read happens once, at render time,
 * on the server.
 *
 * FIELD SCOPE IS ENFORCED HERE, NOT JUST AT THE SQL LAYER (Phase 3's own
 * instruction) — `phone`/`email` are never set on the `StaffPerson` object
 * below, even though `getPublicStaffRoster()`'s own `SECURITY DEFINER`
 * function already never selects `contact_methods` in the first place. Two
 * independent enforcement points for the same rule, not redundant: a future
 * change to either this mapping or that function's column list alone still
 * can't leak a contact field past the OTHER one.
 *
 * Imports `StaffList` DIRECTLY from `presby-site-kit`, NOT through the
 * block-registry's `staffList` block type — that type's props come from
 * hand-authored MDX front matter (a human typed them in), a categorically
 * different trust tier than a live database read. This component is wired
 * in as a `liveSlots.staffDirectory` RESOLVER FUNCTION instead (see
 * `page.tsx`, presby-site-kit v4.0.0/DECISION-132), which a
 * `{"type": "liveSlot", "props": {"slot": "staffDirectory", "filter": {...}}}`
 * marker block in the content picks up wherever a content author placed it,
 * with that marker's own `filter` object resolved at exactly that point.
 *
 * `filter` arrives as a lower-trust, author-typed `Record<string, unknown>`
 * (the marker's own JSON `props.filter`, or `{}` when the marker carries
 * none — presby-site-kit's own `renderLiveSlotBlock` guarantees this
 * component is never called with `undefined`) and is narrowed through
 * `parseStaffRosterFilter()` before being handed to `getPublicStaffRoster()`
 * — each key is checked by `typeof`/exact-value, and silently dropped if
 * malformed, the same defensive-narrowing posture `extractBlocks`/`isRecord`
 * already use one layer down in site-kit. A typo'd or garbled filter value
 * never throws; it simply fails to narrow (Phase 1's own "silent
 * filter-typo failure" gap — named, not solved, here).
 *
 * EMPTY ROSTER GETS ITS OWN EXPLICIT BRANCH, not a delegation to `StaffList`
 * (which returns `null` on an empty array) — a silent `null` here would be
 * indistinguishable from a broken slot to whoever is reviewing the page
 * (Phase 1 Gap "Empty state"). This is also the correct response to a filter
 * that narrows to zero currently-public rows, not just to zero rows overall.
 *
 * Render mechanism is UNCHANGED regardless of filter — still `<StaffList
 * people={...} />` from `presby-site-kit`, now built from the filtered
 * roster instead of always the full one (Phase 3's own ruling: `PersonCard`
 * is for the committee grid's grouped-sections case, not a replacement for
 * `StaffList`'s flat "everyone" shape).
 */
function parseStaffRosterFilter(
  raw: Record<string, unknown>,
): PublicStaffRosterFilter {
  const filter: PublicStaffRosterFilter = {};
  if (raw.kind === "staff" || raw.kind === "officer") {
    filter.kind = raw.kind;
  }
  if (typeof raw.department === "string") {
    filter.department = raw.department;
  }
  if (typeof raw.office === "string") {
    filter.office = raw.office;
  }
  if (typeof raw.hasPriority === "boolean") {
    filter.hasPriority = raw.hasPriority;
  }
  return filter;
}

export async function PublicStaffDirectory({
  slug,
  filter,
}: {
  slug: string;
  filter: Record<string, unknown>;
}) {
  const entries = await getPublicStaffRoster(slug, parseStaffRosterFilter(filter));

  if (entries.length === 0) {
    return <p>No one has been listed here yet.</p>;
  }

  const people: StaffPerson[] = entries.map((entry) => ({
    name: entry.displayName,
    title: entry.roleLabel,
    photoUrl: entry.photoKey ? `/site/${slug}/assets/${entry.photoKey}` : undefined,
  }));

  return <StaffList people={people} />;
}
