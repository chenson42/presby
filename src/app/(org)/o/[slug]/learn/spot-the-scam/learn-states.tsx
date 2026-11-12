import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FeaturesHelpLink } from "@/components/help/features-help-link";
import { ORG_PAGE } from "@/lib/learn/spot-the-scam/copy";

/**
 * The honest non-data answers `/o/<slug>/learn/spot-the-scam` can give (Copy G8). The
 * four-way miss for an unknown or unauthorized organization is one level up
 * (`org-states.tsx`). Both render at HTTP 200: the viewer is a member and already knows the
 * organization exists, so the off state must never hide that the page exists.
 */

/** The toggle (or the Learn category) is off. Shown to every member, so the Features link appears only for someone who can use it. */
export function LearnOff({ name, slug, canManageFeatures }: { name: string; slug: string; canManageFeatures: boolean }) {
  return (
    <section className="max-w-2xl" data-testid="learn-off">
      <h1 className="text-2xl font-semibold">{ORG_PAGE.heading}</h1>
      <p className="mt-3 text-base text-muted-foreground [overflow-wrap:anywhere]">
        {ORG_PAGE.off(name)}{" "}
        {canManageFeatures ? (
          <Link
            href={`/o/${slug}/admin/features`}
            className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {ORG_PAGE.offLink}
          </Link>
        ) : (
          ORG_PAGE.offAsk(name)
        )}
      </p>
      <FeaturesHelpLink />
    </section>
  );
}

/** A read failed: say so and offer a retry. Never "off", which would read as the feature being gone. */
export function LearnLoadError({ slug }: { slug: string }) {
  return (
    <section className="max-w-2xl" data-testid="learn-load-error">
      <h1 className="text-2xl font-semibold">{ORG_PAGE.heading}</h1>
      <p role="alert" className="mt-3 text-base font-medium">
        {ORG_PAGE.loadError}
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/learn/spot-the-scam`}>{ORG_PAGE.tryAgain}</Link>
      </Button>
    </section>
  );
}
