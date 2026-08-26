import { Home, MapPin, Users } from "lucide-react";
import { ButtonGroup, type ButtonGroupItem } from "@/components/shared/button-group";

/**
 * Members / Households / Parishes — a `ButtonGroup` of real `<Link>`s (a GET
 * navigation, not a client tab switcher) so every page that renders this
 * stays a Server Component and the browser back button behaves normally.
 *
 * Extracted out of `page.tsx` in Increment 4 (it was a private
 * `DirectoryViewTabs` function there through Increment 3) so `directory/
 * parishes/page.tsx` can render the SAME nav rather than a hand-copied one —
 * two nav components that could drift on which tab is "current" would be
 * exactly the kind of thing this feature's own cross-cutting risk note warns
 * against for its read functions.
 *
 * The Parishes tab is shown ONLY when `canViewHidden` — checked DIRECTLY via
 * `hasPermission(..., 'directory.view_hidden')` by every caller of this
 * component, never a flag (Phase 3 design: "a nav 'Parishes' link is shown
 * only when `hasPermission(...)` is true, checked directly"). An ordinary
 * viewer never sees the tab exists; `getParishRoster()` re-verifies the same
 * permission regardless, so this is a visibility convenience, not the
 * enforcement.
 */
export function DirectoryNav({
  slug,
  view,
  search,
  canViewHidden,
}: {
  slug: string;
  view: "members" | "households" | "parishes";
  search: string;
  canViewHidden: boolean;
}) {
  const searchParam = search ? `search=${encodeURIComponent(search)}` : "";
  const membersHref = `/o/${slug}/directory${searchParam ? `?${searchParam}` : ""}`;
  const householdsHref = `/o/${slug}/directory?view=households${
    searchParam ? `&${searchParam}` : ""
  }`;
  const parishesHref = `/o/${slug}/directory/parishes`;

  const items: ButtonGroupItem[] = [
    {
      key: "members",
      label: "Members",
      href: membersHref,
      icon: Users,
      active: view === "members",
      "aria-current": view === "members" ? "page" : undefined,
    },
    {
      key: "households",
      label: "Households",
      href: householdsHref,
      icon: Home,
      active: view === "households",
      "aria-current": view === "households" ? "page" : undefined,
    },
  ];
  if (canViewHidden) {
    items.push({
      key: "parishes",
      label: "Parishes",
      href: parishesHref,
      icon: MapPin,
      active: view === "parishes",
      "aria-current": view === "parishes" ? "page" : undefined,
    });
  }

  return (
    <div className="mt-4">
      <ButtonGroup items={items} aria-label="Directory view" />
    </div>
  );
}
