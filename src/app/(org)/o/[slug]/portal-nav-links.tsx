"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PortalNavEntry {
  label: string;
  href: string;
  /** `true` for Home and every domain-anchor entry (`#domain-<key>`) —
   * matches only the exact (fragment-stripped) pathname. Anchor entries MUST
   * be `exact: true`: their stripped target is `/o/<slug>` itself, identical
   * to Home's, and a non-exact `startsWith` match against that target would
   * read as "active" on every subpage in the org (docs/work-log/
   * 2026-08-27-product-ia-scaffold.md Phase 3 §5). Every other entry matches
   * on `startsWith`, so a child route (e.g. `/directory/<id>`) still shows
   * its section as active. */
  exact: boolean;
}

/**
 * The active-state client leaf for `PortalNav` — the one piece of this row
 * that needs `usePathname()` (a client-only hook), following the same
 * server-shell / client-leaf split `GlobalNav` already uses for
 * `OrgSwitcher`/`AvatarMenu` (Phase 2 architect ruling).
 *
 * Below `sm` (640px): a single toggle button opens a stacked, full-width
 * menu — closes on navigation (route change) and on re-toggle, matching the
 * public site-kit `Nav`'s own mobile-toggle contract. At `sm` and up: the
 * original always-visible wrapped row, unchanged. The prior "wrap, not
 * hamburger" design (a flex-wrap row with no collapse at all) read to a
 * user on a real phone as "not responsive" — five entries wrapped into two
 * lines of plain text under the header, not a menu. This keeps the same
 * link set and active-state logic; only the narrow-viewport presentation
 * changes.
 *
 * OVERLAY, NOT IN-FLOW (docs/work-log/2026-08-26-portal-ux-fixes.md, Wave
 * 1B, finding L5): below `sm`, the open menu is `absolute` (positioned off
 * the toggle row's `relative` parent, `top-full` so it sits directly under
 * it) and `z-20` so it draws over whatever the page renders next, instead of
 * pushing that content down. No Radix `Sheet` — this is a pure
 * positioning/layering change to the SAME single link list `sm:` already
 * repositions between "in-flow flex" and "always visible"; the mechanism
 * generalizes from "flex vs hidden" to "flex-and-absolute vs hidden", one
 * more class each side of the same `open` boolean. `shadow-lg` + `bg-
 * background` + `border-border` give it a visible edge over whatever page
 * content now sits directly beneath it instead of being pushed away.
 */
export function PortalNavLinks({ entries }: { entries: PortalNavEntry[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // HASH-STRIPPING (commit 2, docs/work-log/2026-08-27-product-ia-scaffold.md
  // Phase 3 §5, DECISION-117). `usePathname()` NEVER includes a `#fragment`
  // — Next's router doesn't expose it — so a domain-anchor entry's raw
  // `href` (e.g. `/o/alpha#domain-people`) can never equal `pathname` as-is.
  // Comparisons run against the href's PATH PORTION ONLY, with the fragment
  // stripped; `<Link href={entry.href}>` below stays the raw, un-stripped
  // href so the fragment survives into the actual navigation (the browser
  // needs it to scroll) — only the MATCHING logic strips it.
  const targetOf = (href: string) => href.split("#")[0]!;

  const matchesEntry = (entry: PortalNavEntry) => {
    const target = targetOf(entry.href);
    return entry.exact
      ? pathname === target
      : pathname === target || pathname?.startsWith(`${target}/`);
  };

  // MOST-SPECIFIC MATCH WINS, not "every entry whose href happens to be a
  // pathname prefix." Found live: several "operate" tiles route through
  // `/o/<slug>/admin/*` (Members, Officers, Groups) even though they aren't
  // Organization Administration hub destinations — on `/o/<slug>/admin/groups`,
  // both "Groups" (`/o/<slug>/admin/groups`, exact-equal) and "Administration"
  // (`/o/<slug>/admin`, a prefix of that same path) satisfied `matchesEntry`,
  // so both lit up at once. Resolving to the single longest-href match, same
  // algorithm most routers use for nested-route active state, means a more
  // specific route always shadows a shorter one that merely happens to share
  // its URL prefix — no per-tile special-casing needed here or in tiles.ts.
  //
  // THE SPECIFICITY TIE-BREAK USES THE STRIPPED TARGET'S LENGTH, NOT THE RAW
  // HREF'S — an anchor entry's raw length is inflated by its `#fragment` and
  // must not win a specificity contest it didn't earn on path length alone.
  // Net effect on `/o/<slug>` itself: every domain-anchor entry strips to the
  // identical target (`/o/<slug>`) as Home, so Home — listed first — wins
  // every tie, and no domain anchor ever shows as independently "active."
  // This is an accepted, named limitation (Phase 3 §5): `usePathname()`
  // cannot see scroll position, and a client-side scroll-spy is out of scope
  // (no new dependency).
  //
  // TRACKS THE WINNING ENTRY ITSELF, NOT JUST ITS STRIPPED TARGET STRING —
  // a same-length tie between two DIFFERENT entries (Home and every domain
  // anchor on `/o/<slug>` all strip to the identical target) must resolve to
  // exactly ONE winner, the first one encountered (Home, listed first), not
  // to "every entry whose stripped target happens to equal the winning
  // string." Comparing by string equality alone would mark ALL of them
  // active simultaneously on a length tie, which is not "Home wins" at all —
  // this is the implementation correction that makes the prose guarantee
  // above actually hold.
  let activeEntry: PortalNavEntry | null = null;
  let activeTargetLength = -1;
  for (const entry of entries) {
    if (!matchesEntry(entry)) continue;
    const targetLength = targetOf(entry.href).length;
    if (activeEntry === null || targetLength > activeTargetLength) {
      activeEntry = entry;
      activeTargetLength = targetLength;
    }
  }
  const isEntryActive = (entry: PortalNavEntry) => entry === activeEntry;

  // The `border-b-2` accent (docs/work-log/
  // 2026-08-26-portal-visual-modernization.md Phase 3) is applied
  // UNCONDITIONALLY — `border-primary` when active, `border-transparent`
  // when not — never omitted for either state. An active-only border would
  // shift every link's vertical position by 2px when its active state
  // toggles, at both the desktop wrapped-row and mobile stacked-menu
  // presentations.
  const linkClassName = (isActive: boolean) =>
    cn(
      "flex min-h-11 items-center rounded-md border-b-2 px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-0 sm:px-1 sm:py-1",
      isActive
        ? "border-primary font-semibold text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );

  return (
    <nav
      aria-label="Portal"
      className="relative border-b border-border sm:px-6"
    >
      <div className="flex items-center justify-between px-4 py-2 sm:hidden">
        <span className="text-sm font-semibold text-foreground">Menu</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="portal-nav-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
          className="flex size-11 items-center justify-center rounded-md text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>

      {/* One link list in the DOM, styled two ways by breakpoint — never
       * two copies. A duplicated list would double every accessible link
       * (screen readers, `getByRole`) even while only one copy is visually
       * shown; `hidden` vs `sm:flex` on the SAME element is what lets CSS
       * alone decide which layout renders, at each breakpoint, from one
       * source of truth. */}
      <div
        id="portal-nav-menu"
        className={cn(
          "absolute inset-x-0 top-full z-20 flex-col gap-1 border border-border bg-background px-4 pt-3 pb-3 text-sm shadow-lg sm:static sm:flex sm:flex-row sm:flex-wrap sm:gap-4 sm:border-0 sm:bg-transparent sm:px-6 sm:py-2 sm:shadow-none",
          open ? "flex" : "hidden",
        )}
      >
        {entries.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            aria-current={isEntryActive(entry) ? "page" : undefined}
            className={linkClassName(isEntryActive(entry))}
          >
            {entry.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
