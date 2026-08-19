import Link from "next/link";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { resolveOrgContext } from "@/lib/authz";
import { getOrgBrandForLayout } from "@/lib/brand/read-org-brand";
import { BrandTokens } from "@/components/brand/brand-tokens";
import { GlobalNav } from "@/components/shared/global-nav";
import { cn } from "@/lib/utils";

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
 *
 * BRAND EMISSION (P0.5 slice c, commit `c4`) hangs off the exact same
 * "renders on every page under here" property, deliberately. This layout
 * resolves the slug against the user's OWN membership set — same mechanism
 * `page.tsx` uses, independently, for its own gate — and only when that
 * resolves to an ACTIVE relationship does it ask `getOrgBrandForLayout()` for
 * this organization's tokens. Every other outcome (`forbidden`, `ended`,
 * `not-found`, no session) leaves `orgBrand` at `null`, `<BrandTokens>`
 * renders `null`, and the access-denied / ended / 404 pages this layout
 * wraps stay on the platform palette — DECISION-040's byte-identical copy is
 * untouched, because nothing here varies STRUCTURE or TEXT, only which
 * custom properties a `<style>` tag declares. `getOrgBrandForLayout()` itself
 * re-verifies membership inside `withOrgContext()` regardless of what this
 * resolve found, so a relationship that vanishes in the gap degrades to
 * `null`, not to a crash or to someone else's colours.
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

  let orgBrand: Awaited<ReturnType<typeof getOrgBrandForLayout>> = null;
  if (session?.user) {
    const resolved = await resolveOrgContext(session.user.id, slug);
    if (resolved.kind === "ok") {
      // BOTH ids from the SAME resolution, not `session.user.id` — see
      // read-org-brand.ts's header comment for why that distinction is
      // load-bearing (`users.id` vs. `people.id`) and not a style choice.
      orgBrand = await getOrgBrandForLayout(
        resolved.org.organizationId,
        resolved.org.personId,
      );
    }
  }

  return (
    <>
      <BrandTokens brand={orgBrand?.tokens ?? null} />
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
      <main
        className={cn(
          "mx-auto max-w-4xl px-6 py-12",
          orgBrand?.fontPairing.bodyClassName,
        )}
      >
        {children}
      </main>
    </>
  );
}
