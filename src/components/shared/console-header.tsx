import Link from "next/link";
import { AvatarMenu } from "@/components/shared/avatar-menu";
import { ConsoleMobileMenu } from "@/components/shared/console-mobile-menu";
import type { ConsoleNavLinkGroup } from "@/components/shared/console-nav-links";
import { APP_VERSION } from "@/lib/version";

/**
 * The console's header: skip link, the way back to the signed-in chooser, the
 * console label, the phone Menu button and the avatar menu.
 *
 * `AvatarMenu`, NOT `GlobalNav` (DECISION-253): `GlobalNav` carries an
 * `OrgSwitcher`, which would put `/o/` links and a tenant read in platform
 * chrome. The avatar menu is the SINGLE sign-out path; the layout's old inline
 * `signOut` form is gone.
 *
 * The back link goes to `/home`, the signed-in chooser, not the public front
 * page (operator report 2026-10-23, docs/work-log/2026-10-23-admin-back-link.md).
 * "Platform admin" names the console (G20); it is hidden below `sm` so one row
 * fits 360px: Menu button, wordmark link, avatar, each at least 44px.
 *
 * Shared by the platform console and the developer portal (DECISION-261); every
 * prop is required. `canAccessDeveloper` is the LIVE entitlement read, passed
 * in (a failed read degrades to `false`). `canAccessAdmin` is the session claim:
 * the console passes `true` (the proxy admitted the viewer), the developer
 * portal passes the real claim so no dead "Platform admin" item appears.
 */
// ui-ok: header text link, styled for a focus ring and weight, not a button
const HOME_LINK_CLASS = "inline-flex min-h-11 shrink-0 items-center rounded-md px-1 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
// ui-ok: skip link, visible only on focus
const SKIP_LINK_CLASS = "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:ring-2 focus:ring-ring";

export function ConsoleHeader({
  groups,
  consoleLabel,
  idPrefix,
  mainId,
  name,
  email,
  canAccessAdmin,
  canAccessDeveloper,
}: {
  groups: readonly ConsoleNavLinkGroup[];
  /** The `sm:` label naming the console ("Platform admin", "Developer portal"). */
  consoleLabel: string;
  idPrefix: string;
  /** The id of the page's `<main>`; the skip link targets it. */
  mainId: string;
  name: string | null | undefined;
  email: string | null | undefined;
  canAccessAdmin: boolean;
  /** Passed to `AvatarMenu`'s `isPlatformAdmin` prop (the Developer item). */
  canAccessDeveloper: boolean;
}) {
  return (
    <header className="relative border-b border-border bg-background">
      <a href={`#${mainId}`} className={SKIP_LINK_CLASS}>
        Skip to main content
      </a>
      <div className="flex items-center justify-between gap-2 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <ConsoleMobileMenu
            groups={groups}
            version={APP_VERSION}
            consoleLabel={consoleLabel}
            idPrefix={idPrefix}
          />
          <Link href="/home" className={HOME_LINK_CLASS}>
            ← PresbyPortal
          </Link>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {consoleLabel}
          </span>
        </div>
        <nav aria-label="Account" className="flex shrink-0 items-center">
          <AvatarMenu
            name={name}
            email={email}
            canAccessAdmin={canAccessAdmin}
            isPlatformAdmin={canAccessDeveloper}
          />
        </nav>
      </div>
    </header>
  );
}
