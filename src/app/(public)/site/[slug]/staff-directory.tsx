import { StaffList, type StaffPerson } from "presby-site-kit";
import { getPublicStaffRoster } from "@/lib/sites";

/**
 * `/site/<slug>`'s `staffDirectory` live slot (docs/work-log/
 * 2026-08-27-public-staff-directory.md, Phase 3/4) — a plain `async` Server
 * Component, co-located exactly like `contact-form.tsx` (this route's other
 * per-feature component), but with NO `"use client"`: unlike `ContactForm`,
 * this component submits nothing and needs no event handlers, hooks, or
 * browser APIs — the read happens once, at render time, on the server.
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
 * in as a `liveSlots.staffDirectory` element instead (see `page.tsx`), which
 * a `{"type": "liveSlot", "props": {"slot": "staffDirectory"}}` marker block
 * in the content picks up wherever a content author placed it.
 *
 * EMPTY ROSTER GETS ITS OWN EXPLICIT BRANCH, not a delegation to `StaffList`
 * (which returns `null` on an empty array) — a silent `null` here would be
 * indistinguishable from a broken slot to whoever is reviewing the page
 * (Phase 1 Gap "Empty state").
 */
export async function PublicStaffDirectory({ slug }: { slug: string }) {
  const entries = await getPublicStaffRoster(slug);

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
