import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Members / Households / Parishes — plain `<Link>`s (a GET navigation, not a
 * client tab switcher) so every page that renders this stays a Server
 * Component and the browser back button behaves normally.
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

  return (
    <nav className="mt-4 flex flex-wrap gap-2" aria-label="Directory view">
      <Button
        asChild
        variant={view === "members" ? "default" : "outline"}
        size="sm"
        className="min-h-11"
      >
        <Link
          href={membersHref}
          aria-current={view === "members" ? "page" : undefined}
        >
          Members
        </Link>
      </Button>
      <Button
        asChild
        variant={view === "households" ? "default" : "outline"}
        size="sm"
        className="min-h-11"
      >
        <Link
          href={householdsHref}
          aria-current={view === "households" ? "page" : undefined}
        >
          Households
        </Link>
      </Button>
      {canViewHidden && (
        <Button
          asChild
          variant={view === "parishes" ? "default" : "outline"}
          size="sm"
          className="min-h-11"
        >
          <Link
            href={parishesHref}
            aria-current={view === "parishes" ? "page" : undefined}
          >
            Parishes
          </Link>
        </Button>
      )}
    </nav>
  );
}
