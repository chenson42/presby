"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The link list and the active state, the one piece of the console nav that
 * needs `usePathname()`. A client leaf under a server shell (`ConsoleNav`), the
 * same split `GlobalNav` and the org portal's `PortalNavLinks` use.
 *
 * It receives PLAIN DATA ({label, href, exact}), never functions or icon
 * components: a Lucide component object crossing the server/client boundary is
 * a live 500 (portal-nav-links.tsx documents the incident). `onNavigate` is
 * the one function prop and is only ever passed by another client component
 * (`ConsoleMobileMenu`), never by a Server Component.
 *
 * ACTIVE STATE: an item matches when `pathname === href` or
 * `pathname.startsWith(href + "/")` (a segment boundary, so
 * `/admin/organizationsX` does not light Organizations); an `exact` item
 * matches only on equality. Of the matches, the LONGEST matching prefix (href or `alsoActiveOn`) wins, and it
 * alone gets `aria-current="page"`. So `/admin/organizations/domains` lights
 * Domains and not Organizations, `/admin/organizations/<id>` lights
 * Organizations, and an unknown `/admin/whatever` lights nothing (Dashboard is
 * exact). The active item is marked by weight and fill AND `aria-current`,
 * never by colour alone.
 */
export interface ConsoleNavLinkItem {
  label: string;
  href: string;
  exact?: boolean;
  /** Extra path prefixes (segment boundary) that also light this item, e.g.
   * a detail route that does not live under `href`. */
  alsoActiveOn?: readonly string[];
}

export interface ConsoleNavLinkGroup {
  key: string;
  heading: string | null;
  footer?: boolean;
  items: readonly ConsoleNavLinkItem[];
}

/** The href of the single active item, or null. Exported for the unit test. */
export function activeNavHref(
  pathname: string | null,
  groups: readonly ConsoleNavLinkGroup[],
): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  let bestLen = -1;
  for (const group of groups) {
    for (const item of group.items) {
      const prefixes = item.exact
        ? [item.href]
        : [item.href, ...(item.alsoActiveOn ?? [])];
      let longest = -1;
      for (const prefix of prefixes) {
        const hit =
          pathname === prefix ||
          (!item.exact && pathname.startsWith(`${prefix}/`));
        if (hit && prefix.length > longest) longest = prefix.length;
      }
      if (longest >= 0 && (best === null || longest > bestLen)) {
        best = item.href;
        bestLen = longest;
      }
    }
  }
  return best;
}

// Nav links, not buttons: rounded/px/weight exist for the active pill and the
// focus ring's hit area, not to imitate <Button>. One constant per class
// string so the ui-ok marker sits on the line directly above each.
// ui-ok: nav link, not a button
const LINK_BASE = "flex min-h-11 items-center rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
// ui-ok: nav link active state, not a button
const LINK_ACTIVE = "bg-primary font-semibold text-primary-foreground";
const LINK_IDLE = "text-foreground hover:bg-accent hover:text-accent-foreground";

export function ConsoleNavLinks({
  groups,
  idPrefix,
  onNavigate,
}: {
  groups: readonly ConsoleNavLinkGroup[];
  /** Heading-id prefix; `/admin` passes `admin-nav` so its ids are unchanged. */
  idPrefix: string;
  /** Called on a link click. The phone menu uses it to close on a click on the
   * current page's own link, where the route does not change. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = activeNavHref(pathname, groups);

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div
          key={group.key}
          className={cn(group.footer && "border-t border-border pt-5")}
        >
          {group.heading ? (
            <p
              id={`${idPrefix}-${group.key}`}
              className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {group.heading}
            </p>
          ) : null}
          <ul
            aria-labelledby={group.heading ? `${idPrefix}-${group.key}` : undefined}
            className="space-y-0.5"
          >
            {group.items.map((item) => {
              const isActive = item.href === active;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={onNavigate}
                    className={cn(LINK_BASE, isActive ? LINK_ACTIVE : LINK_IDLE)}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
