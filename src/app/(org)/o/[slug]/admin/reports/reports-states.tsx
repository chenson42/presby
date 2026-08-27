import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The non-data-bearing answers `/o/<slug>/admin/reports`'s TWO independent
 * sections (statistics, per-capita) can give, beyond the shared
 * `PlaceholderFlagOff`/`PlaceholderNotAvailable`
 * (`@/components/org-portal/coming-soon`) the page itself keeps reusing
 * verbatim for the whole-page flag/org-type gate.
 *
 * TWO SECTIONS, TWO INDEPENDENT PERMISSIONS (`statistics.manage`,
 * `per_capita.manage`) — a viewer could hold one and not the other, so
 * `Forbidden` is parameterized by which section it's rendered inside rather
 * than assuming a page-wide denial. Modeled on `../credentials/
 * credentials-states.tsx`'s `Forbidden`/`LoadError` pair.
 */
export function ReportsSectionForbidden({
  section,
  name,
}: {
  section: string;
  name: string;
}) {
  return (
    <p className="text-sm text-muted-foreground">
      You don&apos;t have permission to manage {section} at {name}. If you
      think this is a mistake, ask your presbytery&apos;s administrator.
    </p>
  );
}

export function ReportsSectionLoadError({ slug }: { slug: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load this section right now. Try again in a moment.
      </p>
      <Button asChild size="sm" className="min-h-11">
        <Link href={`/o/${slug}/admin/reports`}>Try again</Link>
      </Button>
    </div>
  );
}
