"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
 * WRAP, NOT HAMBURGER — `tickets/layout.tsx`'s exact nav classes
 * (`flex flex-wrap gap-4 text-sm`), the codebase's one existing precedent
 * for org-scoped chrome navigation. There is no hamburger/disclosure
 * component in this tree and this pipeline does not introduce one.
 */
export function PortalNavLinks({ entries }: { entries: PortalNavEntry[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Portal"
      className="flex flex-wrap gap-4 border-b border-border px-4 py-2 text-sm sm:px-6"
    >
      {entries.map((entry) => {
        const isActive = entry.exact
          ? pathname === entry.href
          : pathname === entry.href || pathname?.startsWith(`${entry.href}/`);

        return (
          <Link
            key={entry.href}
            href={entry.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-md px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isActive
                ? "font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
          </Link>
        );
      })}
    </nav>
  );
}
