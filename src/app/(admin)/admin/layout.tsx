import { redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { cachedIsPlatformAdmin } from "@/lib/nav-data";
import { ConsoleHeader } from "@/components/shared/console-header";
import { ConsoleNav } from "@/components/shared/console-nav";
import { visibleAdminNav } from "./visible-nav";

/**
 * The platform console shell: header (skip link, back link, Menu button on a
 * phone, avatar menu), a grouped permission-filtered sidebar from `md` up, and
 * the page.
 *
 * THE TWO REDIRECTS BELOW ARE UNCHANGED, in order and in body (R9): no session
 * goes to sign-in, a required-but-unverified second factor goes to /totp. The
 * layout test pins both.
 *
 * `isPlatformAdmin` is a LIVE read (it is deliberately not a session claim, so
 * a revocation lands now). It is wrapped in a catch because `error.tsx` cannot
 * catch an error thrown by its own layout (R1d): a blip degrades to "no
 * Developer item in the avatar menu", never a crashed shell.
 *
 * `<main>` is `min-w-0` because a grid item defaults to `min-width: auto`, so
 * one wide table would widen the whole column and push the page sideways at
 * 360px. Its padding is `p-4 sm:p-8`: 16px on a phone (a 328px content width),
 * 32px from `sm` (docs/ui-standards.md, DECISION-253). `tabIndex={-1}` makes it
 * the skip link's focus target.
 *
 * There is NO `loading.tsx` anywhere under this segment (R1c, DECISION-251),
 * and `shell-boundaries.test.ts` pins that. A `loading.tsx` wraps every
 * descendant route in Suspense, which would send the `notFound()` routes out
 * as HTTP 200. Loading feedback is per-card `Suspense` on the dashboard.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await cachedAuth();
  if (!session?.user) redirect("/signin?callbackUrl=/admin");
  if (session.user.twoFactorRequired && !session.user.twoFactorVerified) {
    redirect("/totp?callbackUrl=/admin");
  }

  const isPlatformAdmin = await cachedIsPlatformAdmin(session.user.id).catch(
    () => false,
  );
  const groups = visibleAdminNav(session.user.features);

  return (
    <div className="min-h-screen">
      <ConsoleHeader
        groups={groups}
        consoleLabel="Platform admin"
        idPrefix="admin-nav"
        mainId="admin-main"
        name={session.user.name}
        email={session.user.email}
        canAccessAdmin
        canAccessDeveloper={isPlatformAdmin}
      />
      <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
        <ConsoleNav
          groups={groups}
          consoleLabel="Platform admin"
          idPrefix="admin-nav"
        />
        <main id="admin-main" tabIndex={-1} className="min-w-0 p-4 outline-none sm:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
