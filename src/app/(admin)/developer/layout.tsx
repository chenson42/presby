import type { Metadata } from "next";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { sessionCanAccessAdmin } from "@/lib/platform-admin";
import { DEVELOPER_NAV_GROUPS } from "@/lib/developer-portal/nav";
import { ConsoleHeader } from "@/components/shared/console-header";
import { ConsoleNav } from "@/components/shared/console-nav";
import { readEntitled } from "./guard";

export const metadata: Metadata = {
  title: { template: "%s · Developer portal", default: "Developer portal" },
};

/**
 * The developer portal's frame: header, left nav (a sheet on a phone), the page.
 * CHROME ONLY. It never gates, never redirects; authorizing is each page's job
 * (`requireDeveloper`, Ruling 3).
 *
 * - No session, or a required-but-unverified second factor: render `children`
 *   bare. The proxy and the page gate redirect those viewers, and chrome for
 *   them would only expose the avatar menu of a half-signed-in session.
 * - Otherwise the live entitlement read decides whether the nav exists. The
 *   header always renders (a non-entitled viewer still needs sign-out and a way
 *   back to /home). The read is wrapped in a catch because `error.tsx` cannot
 *   catch an error thrown by its own layout: a blip degrades to "no nav".
 * - `canAccessAdmin` is the REAL session claim, not `true`, so a developer-only
 *   viewer never sees a "Platform admin" avatar item the Edge would bounce
 *   (Ruling 4). The way back to /admin is the avatar menu only.
 *
 * `<main>` is `min-w-0` because a grid item defaults to `min-width: auto`, so
 * one wide table would push the page sideways at 360px; `p-4 sm:p-8` matches
 * the admin console. There is NO `loading.tsx` under this segment
 * (DECISION-251/258): `tables/[table]` and `erd/[module]` call `notFound()`,
 * and a `loading.tsx` would send their 404s out as HTTP 200.
 */
export default async function DeveloperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await cachedAuth();
  const user = session?.user;
  if (!user || (user.twoFactorRequired && !user.twoFactorVerified)) {
    return <>{children}</>;
  }

  const entitled = await readEntitled(user.id).catch(() => false);
  const groups = entitled ? DEVELOPER_NAV_GROUPS : [];

  return (
    <div className="min-h-screen">
      <ConsoleHeader
        groups={groups}
        consoleLabel="Developer portal"
        idPrefix="developer-nav"
        mainId="developer-main"
        name={user.name}
        email={user.email}
        canAccessAdmin={sessionCanAccessAdmin(user)}
        canAccessDeveloper={entitled}
      />
      <div
        className={
          entitled
            ? "grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]"
            : undefined
        }
      >
        {entitled && (
          <ConsoleNav
            groups={groups}
            consoleLabel="Developer portal"
            idPrefix="developer-nav"
          />
        )}
        <main
          id="developer-main"
          tabIndex={-1}
          className="min-w-0 p-4 outline-none sm:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
