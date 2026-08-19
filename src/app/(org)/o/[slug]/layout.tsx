import Link from "next/link";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { GlobalNav } from "@/components/shared/global-nav";

/**
 * The organization shell.
 *
 * It lives at `[slug]` rather than at `(org)` because the header names the
 * organization you are in, and only a layout inside the dynamic segment can see
 * which one that is.
 *
 * STILL NOT THE GATE, and it must never become one. `page.tsx` resolves the
 * slug and calls `assertOrgAccess()`; this layout reads the session only so the
 * header knows whose menus to draw. It passes the slug to `GlobalNav`, which
 * looks it up in the user's OWN organization list — so a slug the user has no
 * relationship with simply does not match, and the switcher falls back to its
 * no-context rendering rather than naming an organization as "current" that the
 * user was just denied.
 *
 * The header renders on the access-denied, relationship-ended and 404 pages too.
 * That is the point: those are the pages a user most needs a way out of, and
 * the switcher is the way out.
 */
export default async function OrgSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await cachedAuth();

  return (
    <>
      {session?.user ? (
        <GlobalNav
          session={session}
          currentOrgSlug={slug}
          contentWidthClassName="max-w-4xl"
        />
      ) : (
        // Unreachable in practice — every page under here redirects a signed-out
        // visitor to /signin. Rendered anyway so that a future route which
        // forgets to, or a render that races a sign-out in another tab, gets a
        // header with a way home instead of a crash on `session.user`.
        <header className="border-b border-border bg-background">
          <div className="mx-auto flex max-w-4xl items-center px-4 py-3 sm:px-6">
            <Link href="/" className="text-sm font-semibold">
              presby
            </Link>
          </div>
        </header>
      )}
      <main className="mx-auto max-w-4xl px-6 py-12">{children}</main>
    </>
  );
}
