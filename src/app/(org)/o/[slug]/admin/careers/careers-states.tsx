import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FeaturesHelpLink } from "@/components/help/features-help-link";

/**
 * The non-data-bearing answers `/o/<slug>/admin/careers` (and `new` and
 * `[postingId]`) can give. The four-way miss for an unknown or unauthorized
 * organization is one level up (`org-states.tsx`). Each is honest about WHICH it is
 * and none names another organization (docs/work-log/2026-10-25-careers-inc1.md,
 * Copy S1-S4).
 */

/** `org_portal.careers` is off. Shown to every member, so the Features link appears only for someone who can use it. */
export function CareersFeatureOff({
  name,
  slug,
  canManageFeatures,
}: {
  name: string;
  slug: string;
  canManageFeatures: boolean;
}) {
  return (
    <section data-testid="careers-feature-off">
      <h1 className="text-2xl font-semibold">Job openings</h1>
      <p className="mt-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
        Job openings aren&apos;t turned on for {name} yet.{" "}
        {canManageFeatures ? (
          <Link
            href={`/o/${slug}/admin/features`}
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Turn them on under Features
          </Link>
        ) : (
          <>Ask someone who manages {name}&apos;s features to turn them on.</>
        )}
      </p>
      <FeaturesHelpLink />
    </section>
  );
}

/** The viewer is in the organization (and the toggle is on) but does not hold `careers.manage`. */
export function CareersForbidden({ name }: { name: string }) {
  return (
    <section data-testid="careers-forbidden">
      <h1 className="text-2xl font-semibold">Job openings</h1>
      <p className="mt-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
        You don&apos;t have permission to manage job openings at {name}. If you think this is a mistake, ask your
        stated clerk or another administrator there.
      </p>
    </section>
  );
}

/** A genuine, non-`OrgAccessError` failure reading postings. */
export function CareersLoadError({ slug }: { slug: string }) {
  return (
    <section data-testid="careers-load-error">
      <h1 className="text-2xl font-semibold">Job openings</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load job openings right now. Try again in a moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/careers`}>Try again</Link>
      </Button>
    </section>
  );
}

/** No posting with that id in this organization (or a malformed id). */
export function CareersNotFound({ slug }: { slug: string }) {
  return (
    <section data-testid="careers-not-found">
      <h1 className="text-2xl font-semibold">Job openings</h1>
      <p className="mt-3 text-sm text-muted-foreground">That job opening couldn&apos;t be found.</p>
      <Button asChild variant="outline" className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/careers`}>Back to job openings</Link>
      </Button>
    </section>
  );
}
