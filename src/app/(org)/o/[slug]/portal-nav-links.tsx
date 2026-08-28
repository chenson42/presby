"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Menu, X, type LucideIcon } from "lucide-react";
import { NAV_DOMAIN_ICONS } from "@/components/org-portal/tile-icons";
import type { PortalDomain } from "@/lib/org-portal/tiles";
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
  /**
   * docs/work-log/2026-08-28-directory-visual-refresh.md, Phase 4, item 3. A
   * KEY into `ICON_BY_KEY` below (`"home"` or a `PortalDomain`), NOT the icon
   * component itself.
   *
   * WHY A STRING, NOT A `LucideIcon` COMPONENT REFERENCE — this file is
   * `"use client"`; `portal-nav.tsx`, which builds these entries, is a
   * Server Component. Passing an actual icon component object as a prop
   * across that boundary is a real, confirmed-live bug, not a style
   * preference: a `lucide-react` icon is `React.forwardRef(...)`, an object
   * with methods, and Next's RSC payload serializer rejects it outright —
   * "Only plain objects can be passed to Client Components from Server
   * Components" — which took the whole page down with a 500 (caught in
   * Phase 4's own live-browser verification pass, not by `tsc` or
   * `next build`, both of which stay green through this exact defect). A
   * plain string key IS serializable, and this file resolves it to the real
   * component locally, entirely on the client side of the boundary — the
   * same `NAV_DOMAIN_ICONS` map `portal-nav.tsx` would otherwise have
   * imported, just resolved one file over from where the icon components
   * themselves get rendered.
   */
  icon?: "home" | PortalDomain;
}

/** `"home"` plus every `NAV_DOMAIN_ICONS` entry — see `PortalNavEntry.icon`'s
 * own doc comment for why resolution happens here, client-side, rather than
 * in `portal-nav.tsx`. */
const ICON_BY_KEY: Record<"home" | PortalDomain, LucideIcon> = {
  home: Home,
  ...NAV_DOMAIN_ICONS,
};

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

  // FILLED, ROUNDED PILL (docs/work-log/2026-08-28-directory-visual-refresh.md,
  // Phase 4, item 3) replaces the PRIOR `border-b-2` underline accent
  // (docs/work-log/2026-08-26-portal-visual-modernization.md Phase 3): the
  // active entry now gets a `bg-primary text-primary-foreground` fill rather
  // than a bottom border. `bg-primary`/`text-primary-foreground` is the SAME
  // brandable pair `Button`'s own `default` variant uses — `--primary-
  // foreground` is derived (`src/lib/brand/generate.ts`) to clear D2's
  // 4.5:1 text-contrast floor against `--primary` for ANY per-org brand
  // seed, so this reads correctly on both the platform default palette and a
  // custom-branded organization (verified live against `/o/fpcw`, Phase 4
  // notes). Unlike the border accent, the pill's own background/padding is
  // IDENTICAL between states (only the fill colour and font-weight change),
  // so the "apply unconditionally to avoid a layout shift" concern the prior
  // comment named no longer applies — there is no border to add or remove.
  const linkClassName = (isActive: boolean) =>
    cn(
      "flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-9 sm:px-3 sm:py-1.5",
      isActive
        ? "bg-primary font-semibold text-primary-foreground"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
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
        {entries.map((entry) => {
          const Icon = entry.icon ? ICON_BY_KEY[entry.icon] : undefined;
          return (
            <Link
              key={entry.href}
              href={entry.href}
              aria-current={isEntryActive(entry) ? "page" : undefined}
              className={linkClassName(isEntryActive(entry))}
            >
              {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
              {entry.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
