"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PortalNavEntry {
  label: string;
  href: string;
  /** `true` for Home — matches only the exact pathname. Every other entry
   * matches on `startsWith`, so a child route (e.g. `/directory/<id>`) still
   * shows its section as active. */
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
 */
export function PortalNavLinks({ entries }: { entries: PortalNavEntry[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isEntryActive = (entry: PortalNavEntry) =>
    entry.exact
      ? pathname === entry.href
      : pathname === entry.href || pathname?.startsWith(`${entry.href}/`);

  const linkClassName = (isActive: boolean) =>
    cn(
      "flex min-h-11 items-center rounded-md px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-0 sm:px-1 sm:py-1",
      isActive
        ? "font-semibold text-foreground"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <nav aria-label="Portal" className="border-b border-border sm:px-6">
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
          "flex-col gap-1 border-t border-border px-4 pb-3 text-sm sm:flex sm:flex-row sm:flex-wrap sm:gap-4 sm:border-t-0 sm:px-6 sm:py-2",
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
