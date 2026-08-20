import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * `/o/<slug>/admin` — minimal tenant-administration chrome. P9
 * (`docs/work-log/2026-08-19-tenant-administration.md`, Phase 3 design).
 *
 * NO AUTH OF ITS OWN. The `(org)` contract puts the auth check in the page,
 * which can see the pathname — a layout cannot, so it would have to guess a
 * `callbackUrl` and lose the deep link (`../page.tsx`'s header has the full
 * rationale; it applies unchanged one level down). Every page under here
 * (today, just `admin/roles/page.tsx`) resolves its own slug and calls
 * `assertOrgAccess()` itself.
 *
 * DOES NOT RENDER `<BrandTokens>`. This layout sits beneath
 * `[slug]/layout.tsx` in the tree and inherits the cascade that layout
 * already emits for free. `check-brand-scope.mjs`'s E1 rule allows exactly
 * two emitters tree-wide (`(org)/o/[slug]/layout.tsx` and the still-unbuilt
 * `(public)/site/[slug]/layout.tsx`) — this file is deliberately not a third
 * one (Phase 2's explicit constraint).
 *
 * NO NAV ARRAY. `admin/roles` is the only page under this layout today — a
 * real tenant nav is deliberately deferred to whichever future page makes a
 * second link exist to navigate between (Phase 1/3), not invented ahead of
 * need the way `(admin)/admin/layout.tsx`'s flat array was.
 *
 * NO EXTRA PADDING WRAPPER. `[slug]/layout.tsx`'s `<main>` already supplies
 * `max-w-4xl px-6 py-12` — docs/ui-standards.md's Page Layout section is
 * explicit that a nested layout must not add a second `container`/padding
 * layer on top of one that already exists.
 */
export default async function OrgAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <div className="space-y-6">
      <Link
        href={`/o/${slug}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to portal
      </Link>
      {children}
    </div>
  );
}
