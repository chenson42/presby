import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The non-data-bearing answers `/o/<slug>/admin/filings` can give, beyond
 * the shared `PlaceholderFlagOff`/`PlaceholderNotAvailable`
 * (`@/components/org-portal/coming-soon`) the page itself reuses verbatim
 * for the whole-page flag/org-type gate. Modeled directly on
 * `../reports/reports-states.tsx` / `../oversight/oversight-states.tsx`'s
 * `Forbidden`/`LoadError` pair — this page has exactly one permission
 * (`statistics.publish`), so `Forbidden` needs no section parameter.
 */

/** A `FilingsResult` returned `{ kind: "forbidden" }` — an active
 *  relationship at this congregation, but no `statistics.publish` grant. */
export function FilingsSectionForbidden({ name }: { name: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      You don&apos;t have permission to manage statistical filings at {name}.
      If you think this is a mistake, ask your congregation&apos;s
      administrator.
    </p>
  );
}

/** A genuine, non-`OrgAccessError` failure. */
export function FilingsLoadError({ slug }: { slug: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load your filing history right now. Try again in a
        moment.
      </p>
      <Button asChild size="sm" className="min-h-11">
        <Link href={`/o/${slug}/admin/filings`}>Try again</Link>
      </Button>
    </div>
  );
}
