"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  ConsoleNavLinks,
  type ConsoleNavLinkGroup,
} from "@/components/shared/console-nav-links";

/**
 * The phone navigation (below `md`): a visible "Menu" button (icon AND text,
 * 44px) that opens a left-hand `Sheet` carrying the same link list the sidebar
 * shows. Radix supplies the focus trap, Escape, scroll lock and the return of
 * focus to the trigger on close; none of it is hand-rolled.
 *
 * It closes on navigation WITHOUT an effect: the open state lives in an inner
 * component keyed by `pathname`, so a route change remounts it closed (the
 * `portal-nav-links.tsx` precedent; an effect that calls `setOpen(false)` on a
 * pathname change is what `react-hooks/set-state-in-effect` rejects).
 * `onNavigate` covers the one case a remount cannot: a click on the link to
 * the page you are already on, where the route does not change.
 *
 * The Menu button is inert before hydration. Accepted (E29): a nav toggle is
 * not a data-writing form (DECISION-159 is about forms), and the desktop
 * sidebar is plain links.
 */
function MobileMenu({
  groups,
  version,
  consoleLabel,
  idPrefix,
}: {
  groups: readonly ConsoleNavLinkGroup[];
  version: string;
  consoleLabel: string;
  idPrefix: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 gap-2 md:hidden"
        >
          <Menu aria-hidden="true" />
          Menu
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="gap-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{consoleLabel}</SheetTitle>
          <SheetDescription className="sr-only">
            {consoleLabel} pages
          </SheetDescription>
        </SheetHeader>
        <nav aria-label={consoleLabel} className="flex-1 overflow-y-auto p-4">
          <ConsoleNavLinks
            groups={groups}
            idPrefix={idPrefix}
            onNavigate={() => setOpen(false)}
          />
          <p className="mt-6 px-3 text-xs text-muted-foreground">
            Version {version}
          </p>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

export function ConsoleMobileMenu({
  groups,
  version,
  consoleLabel,
  idPrefix,
}: {
  groups: readonly ConsoleNavLinkGroup[];
  version: string;
  consoleLabel: string;
  idPrefix: string;
}) {
  const pathname = usePathname();
  // No groups, no Menu: a viewer with no nav (the forbidden state) gets no
  // button that opens an empty sheet.
  if (groups.length === 0) return null;
  return (
    <MobileMenu
      key={pathname}
      groups={groups}
      version={version}
      consoleLabel={consoleLabel}
      idPrefix={idPrefix}
    />
  );
}
