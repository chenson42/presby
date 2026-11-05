import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GATE_COPY, MEMBER_COPY, NAV_COPY } from "@/lib/worship/copy";

/**
 * The honest non-data answers a worship page can give (Copy G2), shared by the
 * member tree and the admin tree: "isn't turned on", "for congregations and new
 * worshiping communities", "you don't have permission", "we couldn't load", and
 * the closed-request state. All render at HTTP 200 - the viewer is a member and
 * already knows the organization exists; none is a 404 (the off state in
 * particular must never hide that Worship exists, or a leader who typed the
 * right URL on the wrong day is stranded).
 *
 * Server components, no hooks, no tenant data.
 */

export function WorshipOff({
  name,
  slug,
  canManageFeatures,
  heading = MEMBER_COPY.home.heading,
}: {
  name: string;
  slug: string;
  canManageFeatures: boolean;
  heading?: string;
}) {
  return (
    <section className="max-w-2xl" data-testid="worship-off">
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="mt-3 text-base text-muted-foreground [overflow-wrap:anywhere]">
        {GATE_COPY.off(name)}{" "}
        {canManageFeatures ? (
          <Link
            href={`/o/${slug}/admin/features`}
            className="inline-flex min-h-11 items-center underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {GATE_COPY.offLink}
          </Link>
        ) : (
          GATE_COPY.offAsk(name)
        )}
      </p>
    </section>
  );
}

export function WorshipNotApplicable({ heading = MEMBER_COPY.home.heading }: { heading?: string }) {
  return (
    <section className="max-w-2xl" data-testid="worship-not-applicable">
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="mt-3 text-base text-muted-foreground">{GATE_COPY.notApplicable}</p>
    </section>
  );
}

export function WorshipForbidden({ name, heading }: { name: string; heading: string }) {
  return (
    <section className="max-w-2xl" data-testid="worship-forbidden">
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="mt-3 text-base text-muted-foreground [overflow-wrap:anywhere]">{GATE_COPY.forbidden(name)}</p>
    </section>
  );
}

/** A read failed: say so and offer a retry. Never an empty list, which would read as lost requests. */
export function WorshipLoadError({ href, heading = MEMBER_COPY.home.heading }: { href: string; heading?: string }) {
  return (
    <section className="max-w-2xl" data-testid="worship-load-error">
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p role="alert" className="mt-3 text-base font-medium">
        {GATE_COPY.loadError}
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={href}>{NAV_COPY.tryAgain}</Link>
      </Button>
    </section>
  );
}

/** "This request is no longer open" (Copy G2), with the way back to the schedule. */
export function RequestClosed({ slug }: { slug: string }) {
  return (
    <section className="max-w-2xl space-y-3" data-testid="request-closed">
      <h1 className="text-2xl font-semibold">{GATE_COPY.closedRequest.heading}</h1>
      <p className="text-base text-muted-foreground">{GATE_COPY.closedRequest.body}</p>
      <Button asChild className="min-h-11">
        <Link href={`/o/${slug}/worship`}>{GATE_COPY.closedRequest.link}</Link>
      </Button>
    </section>
  );
}

/** The plain back link at the top of a sub-page (docs/ui-standards.md: a link, not a Button). */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
}
