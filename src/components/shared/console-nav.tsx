import { APP_VERSION } from "@/lib/version";
import {
  ConsoleNavLinks,
  type ConsoleNavLinkGroup,
} from "@/components/shared/console-nav-links";

/**
 * The desktop sidebar (`md` and up). Below `md` it is `hidden`, and the same
 * link list lives in the phone menu (`ConsoleMobileMenu`), which is rendered only
 * while open, so a link is never in the accessibility tree twice.
 *
 * A Server Component: the groups arrive already filtered by
 * `visibleAdminNav(session.user.features)`, and the only client code is the
 * `ConsoleNavLinks` leaf (active state). The running version is the muted line at
 * the foot ("Version 0.42.3"); `APP_VERSION` is a build-time constant that is
 * safe in the client bundle.
 *
 * Sticky, but it scrolls INTERNALLY (`overflow-y-auto`) so a short laptop
 * viewport cannot hide the Reference group below the fold.
 *
 * Shared by the platform console and the developer portal (DECISION-261): every
 * prop is required, so a caller states its own label and id prefix. Renders
 * nothing when `groups` is empty.
 */
export function ConsoleNav({
  groups,
  consoleLabel,
  idPrefix,
}: {
  groups: readonly ConsoleNavLinkGroup[];
  consoleLabel: string;
  idPrefix: string;
}) {
  if (groups.length === 0) return null;
  return (
    <aside className="hidden border-r border-border bg-muted/40 md:block">
      <nav
        aria-label={consoleLabel}
        className="sticky top-0 max-h-screen overflow-y-auto p-4"
      >
        <ConsoleNavLinks groups={groups} idPrefix={idPrefix} />
        <p className="mt-6 px-3 text-xs text-muted-foreground">
          Version {APP_VERSION}
        </p>
      </nav>
    </aside>
  );
}
