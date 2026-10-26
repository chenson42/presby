import { APP_VERSION } from "@/lib/version";
import type { AdminNavGroup } from "@/lib/admin-portal/nav";
import { AdminNavLinks } from "@/components/admin-portal/admin-nav-links";

/**
 * The desktop sidebar (`md` and up). Below `md` it is `hidden`, and the same
 * link list lives in the phone menu (`AdminMobileMenu`), which is rendered only
 * while open, so a link is never in the accessibility tree twice.
 *
 * A Server Component: the groups arrive already filtered by
 * `visibleAdminNav(session.user.features)`, and the only client code is the
 * `AdminNavLinks` leaf (active state). The running version is the muted line at
 * the foot ("Version 0.42.3"); `APP_VERSION` is a build-time constant that is
 * safe in the client bundle.
 *
 * Sticky, but it scrolls INTERNALLY (`overflow-y-auto`) so a short laptop
 * viewport cannot hide the Reference group below the fold.
 */
export function AdminNav({ groups }: { groups: readonly AdminNavGroup[] }) {
  return (
    <aside className="hidden border-r border-border bg-muted/40 md:block">
      <nav
        aria-label="Platform admin"
        className="sticky top-0 max-h-screen overflow-y-auto p-4"
      >
        <AdminNavLinks groups={groups} />
        <p className="mt-6 px-3 text-xs text-muted-foreground">
          Version {APP_VERSION}
        </p>
      </nav>
    </aside>
  );
}
