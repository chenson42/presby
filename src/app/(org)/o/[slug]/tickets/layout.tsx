import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * `/o/<slug>/tickets*` — minimal chrome for the support-tickets surface.
 * Phase 4 commit 3/3 (`docs/work-log/2026-08-20-support-tickets.md` Phase 3
 * Component/Page Plan).
 *
 * NO AUTH OF ITS OWN — same reasoning as `admin/layout.tsx` one level over in
 * this same tree (whose header is the fuller rationale, unchanged here): a
 * layout cannot see the pathname, so it would have to guess a `callbackUrl`
 * and lose the deep link. Every page under here resolves its own slug and
 * calls `assertOrgAccess()` itself.
 *
 * DOES NOT RENDER `<BrandTokens>` — sits beneath `[slug]/layout.tsx`, which
 * already emits once for the whole `(org)` tree. `check-brand-scope.mjs`
 * allows exactly two emitters tree-wide; this is not a third one.
 *
 * NO EXTRA PADDING WRAPPER — `[slug]/layout.tsx`'s `<main>` already supplies
 * `max-w-4xl px-6 py-12` (docs/ui-standards.md, Page Layout).
 *
 * The nav renders unconditionally (this layout has no data to gate it on) —
 * `tickets/new/page.tsx` is the one that renders an honest forbidden state
 * for a visitor who follows "File a ticket" without holding `tickets.file`.
 */
export default async function TicketsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={`/o/${slug}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to portal
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link
            href={`/o/${slug}/tickets`}
            className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            All tickets
          </Link>
          <Link
            href={`/o/${slug}/tickets/new`}
            className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            File a ticket
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
